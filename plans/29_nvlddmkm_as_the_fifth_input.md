# Plan 29 — `nvlddmkm` as the FIFTH INPUT: the driver's own error channel enters the oracle as an observation, never as a verdict

> **Created:** 2026-08-23 16:4x +03:00 · **Parent:** `researches/15` §5 rank 1 («делать первым») ·
> **Status:** 🟡 IN WORK — opened 2026-08-23 16:4x · **Outbound:** the internal map gains a rule row
> beside R4a-pulse; `AGENT_GUIDE.md` harness table gains the battery's new member

---

## 0. Goal vector

**Pain.** The second of R4's three observations — «the Windows event log» — is blind to the channel by
which THIS card actually complains. `config.FAULT_PROVIDERS` watches four providers; the display
driver's own provider `nvlddmkm` is not among them, and it holds **129 events over 34 days** while
`Display` produced 4107s and not a single 4101, and `WHEA-Logger` is empty over its entire history
(`researches/15` §0, §4). Two of those driver errors landed **inside the rung that killed the machine
on 2026-08-23**, each seconds BEFORE the sampler pulse noticed anything (11:52:04 → pulse 11:52:07;
11:52:14 → pulse 11:52:18).

**Where we want to be.** The driver's error channel is READ and REPORTED next to every fault query,
as a FIFTH INPUT to the edge decision — independent of the four existing observations, arriving with
34 days of history already on disk, and structurally incapable of producing a verdict on its own.

**Goal type:** Achieve (a new observation exists) + Avoid (it must never become a stop).

**The hard constraint this plan exists to respect**, and it is the reason the obvious implementation
is WRONG: `researches/15` §2 scored the signal against **all 12 machine deaths** and found it
**specific but NOT sensitive** — three deaths had a driver error within 10 minutes, but the canonical
BSOD of fact 39 had none for two days, and lone errors on quiet days would have produced false stops.
`ideas/10` §5.5: a mechanism with false stops does not ship at all. §6: no threshold is assigned by
that document, and none is assigned here.

**Therefore: adding `{ provider: 'nvlddmkm', means: 'CRASH' }` to `FAULT_PROVIDERS` is the defect this
plan must not commit.** `verdictFor()` returns `CRASH` on any non-empty `faults`, so a fifth CRASH row
would turn 123 historical driver complaints into 123 stops. The change is a new CLASS, not a new row.

## 1. Acceptance criteria (fit criteria — Scale · Meter · Target)

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **AC1** | The driver's channel is READ | Scale: events returned for provider `nvlddmkm` over a window containing 2026-08-23 11:52 · Meter: `npm run events -- --since 2026-08-23T11:45 --until 2026-08-23T12:00` · Target: **2 events**, ids 153, both listed |
| **AC2** | A signal NEVER becomes a verdict | Scale: `verdictFor()` output over a window holding driver events and no fault · Meter: the same command's ВЕРДИКТ line · Target: **not `CRASH`** — the verdict is unchanged and the signals are printed in their own section |
| **AC3** | The class is proved on a BROKEN version | Scale: red blocks under a mutation that lets a SIGNAL reach the fault list · Meter: the fixture suite / selftest run against the mutated module · Target: **≥ 1 block red**, and the intact module reddens none |
| **AC4** | The fixture is REAL, not constructed | Scale: provenance field of the new fixture · Meter: `expectations.json` + `__fixtures__/README.md` · Target: `CAPTURED on this machine`, and it is the very event `researches/15` §0 names |
| **AC5** | The suite is actually RUN | Scale: presence of `events` in `selftest:all` · Meter: `npm run selftest:all` summary line · Target: the battery names the suite and its blocks are counted in the total |
| **AC6** | Nothing was written to the GPU | Scale: GPU writes during this plan · Meter: the commands used are read-only by the harness table · Target: **0** |

## 2. Evidence already on hand — no recon rung is owed

- `researches/15` — the full inventory, the 12-death scoring table, and the ranking that puts this
  first. Its §2 is what forbids the naive implementation.
- `EXP-0124` — the lesson taken from that scoring: a candidate signal is judged on the NEGATIVE cases.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` → **R4a-pulse** — the precedent shape in this project:
  «НАБЛЮДЕНИЕ, а не пока ещё вердикт», with its promotion gate named as a number.
- Measured 2026-08-23 16:3x on this machine, and it EXTENDS what the research recorded:

  | fact | measured |
  |---|---|
  | total `nvlddmkm` events | **129**, all at level 2 (Error) — there are no informational ones |
  | distinct ids | exactly **two**: `153` (123) and `14` (6) |
  | id 153 payload | `\Device\Video3` · `Error occurred on GPUID: 100` |
  | **id 14 payload — NEW, the research treated the two ids as one lump** | `\Device\Video3` · **`GPU recovery action changed from 0x0 (None) to 0x1 (PF FLR)`** — a driver RECOVERY-POLICY change, not an error report |
  | id 14 timestamps | 08-10 20:55, 08-10 20:58, 08-11 00:34, 08-22 14:57, 08-23 11:35:56, 08-23 11:35:58 — **6 of 6 land on days the machine died or hung** |

## 3. The decision this plan makes, and why (recorded because it is mine, not the owner's)

**Which ids to watch: NONE — the whole provider.** Three reasons, in order of weight:

1. **An id allow-list is how we went blind in the first place.** `Display` is watched at 4101; this
   card only ever emits 4107, so the row has been decorative for the project's whole life. Repeating
   that shape on the channel we just discovered would be repeating the defect.
2. **Every event this provider emits is an Error** (129 of 129, measured). There is no informational
   traffic to filter out, so a filter buys nothing and can only go stale.
3. **The query script already supports it.** `QUERY_PS1` does
   `if ($p.ids -and $p.ids.Count -gt 0) { $filter["ID"] = $p.ids }` — an empty list already means «no
   ID filter» on the Windows side. Only `classifyEvent` disagreed, matching `ids.includes(...)`, which
   is false for an empty list. Making the empty list mean the same thing on both sides REMOVES a
   disagreement rather than adding a feature.

**What is NOT decided here, deliberately:** no threshold, no weighting, no split between id 153 and
id 14. The id-14 observation above is recorded as data, not acted on — 6 events is not a basis for a
rule (`PHILOSOPHY.md` → the three doors; `ideas/10` §5.1).

## 4. Steps

- [ ] **4.1 — the SIGNAL class in `config.mjs`.** A fifth row in `FAULT_PROVIDERS`:
      `{ provider: 'nvlddmkm', ids: [], means: 'SIGNAL', what: …, provable: 'history' }`, with the
      comment naming what was measured, when, and the re-probe command. State in the comment that an
      empty `ids` means «the whole provider».
- [ ] **4.2 — `classifyEvent` learns the two classes.** Returns `{ fault, signal, means, what,
      provable }`. A `SIGNAL` rule yields `fault: false, signal: true` — so every existing consumer
      that filters on `fault` is untouched by construction. An empty `ids` matches any id of that
      provider.
- [ ] **4.3 — `queryFaults` returns `signals` beside `faults`.** Same parse, separate list.
- [ ] **4.4 — `verdictFor` carries the signals WITHOUT letting them vote.** The verdict logic is not
      touched; the returned object gains `signals`, and the reason line for a clean window says the
      driver channel is an input, not a verdict.
- [ ] **4.5 — the CLI prints a СИГНАЛЫ section**, labelled as an input, never as a fault.
- [ ] **4.6 — the captured fixture + its expectation.** `nvlddmkm_153_inside_the_fatal_rung__captured.xml`
      (already taken, 2026-08-23 16:3x — the 11:52:04 event itself) and a second one for id 14, so the
      recovery-action shape is parsed too. `expectations.json` gains `signal`; `runFixtureSuite`
      checks it.
- [ ] **4.7 — mutation proof (AC3).** Break it three ways, one at a time: (a) make `SIGNAL` fall
      through into `faults`; (b) make an empty `ids` match nothing; (c) let `verdictFor` count
      signals. Each must redden its own block; the intact module must redden none.
- [ ] **4.8 — `events` enters `selftest:all`.** With the inertness proof written NEXT to the entry, as
      the list's own rule (paid for by `bugs/27`) requires: the suite reads two fixed fixture
      directories and touches neither the card, nor `runs/`, nor a port.
- [ ] **4.9 — documents.** `researches/15` gains the id-14 finding and a closing status; the internal
      map gains the rule row; `AGENT_GUIDE.md`'s harness table and truth↔mirror registry are updated;
      `STATUS.md` gains the session block.

## 5. Verification by observation

| what | command | what must be seen |
|---|---|---|
| AC1 | `npm run events -- --since 2026-08-23T11:45 --until 2026-08-23T12:00` | the provider answers `ok`, событий 2 |
| AC2 | the same run | `ВЕРДИКТ` is NOT `CRASH`; the driver events appear under СИГНАЛЫ |
| AC3 | the mutations of 4.7, one at a time | each reddens its own block; intact code reddens none |
| AC4/AC6 | `npm run events -- --fixtures` | all fixtures agree; the run reads files and touches no GPU |
| AC5 | `npm run selftest:all` | `events` named in the run, its blocks in the total |

## 6. Risks

| # | risk | tier | contingency |
|---|---|---|---|
| R1 | A consumer reads `classifyEvent().fault` loosely (e.g. truthiness of the object) and starts treating signals as faults | (a) highest | grep every call site before the edit; the two-class return keeps `fault` strictly boolean |
| R2 | The Windows log rolls over and the historical evidence disappears | (b) plausible | the fixture is CAPTURED to disk in this plan — that is what makes the evidence outlive the log |
| R3 | A future driver update emits a new id we have not characterized | (c) low | watching the whole provider is precisely the mitigation; the payload travels in the event's own data |
| R4 | Adding a fifth provider slows `queryFaults` | (c) low | one more `Get-WinEvent` in the same script; the sweep queries per rung, not per second |

## 7. What this plan explicitly does NOT do

- **It assigns no threshold and arms no stop.** Promotion of this input into a verdict needs the same
  kind of gate the pulse has, and that gate needs data this project does not have yet.
- **It does not change the pulse, the oracle's three observations, or any verdict.**
- **It does not touch TDR registry settings** (`researches/15` §4 records them as untouched defaults;
  they are the fourth layer of the safety net).
