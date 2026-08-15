# Research 10 — The virtual GPU bench: how the industry fakes hardware without faking its own proof

> **Created:** 2026-08-15 18:4x +03:00 (agent, rung 1 of `/plan-epic` for `ideas/04`, on the owner's
> instruction *«в новом пишем эпик и операционные планы и принимаемся за имплементацию стенда»*)
> **Parent:** `ideas/04_virtual_gpu_test_bench.md` (the owner's ask and the seven items he asked the
> planning to answer) · `plans/13` + `plans/15` (the engine this bench exists to debug) ·
> `researches/02` (the Vmin physics the failure model must not contradict)
> **Status:** 🔬 written BEFORE the meta-plan and before a line of bench code. Every local number in §3
> was read off this repository today; every industry claim in §2 carries its source URL.
> **Outbound:** the contract-suite finding → the epic's acceptance criteria and
> `TESTING_FRAMEWORK.md` (the provability boundary gets a mechanism, not a footnote) · the failure
> model → the epic's §"decisions without the owner" · the consolidation of the hand-rolled doubles →
> `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`

---

## 0. What this document answers, and what it deliberately does not

The owner asked for a virtual GPU to debug the sweep engine on before it ever touches his card. That
ask has a name in this industry, a large body of practice behind it, and one classic failure mode —
**a fake that drifts from the real thing and turns green into a lie**. This document exists so the
epic is designed from that practice instead of from an agent's recollection of it.

**Four questions, and nothing else:**

1. Has this been solved, and by whom, and what did they abandon along the way? (§2)
2. What seams, doubles and constraints already exist in THIS repository? (§3)
3. What does all that force the epic's shape to be? (§4)
4. What must the owner decide, if anything? (§5)

**Not here:** the Vmin method (`researches/02`), the search space arithmetic (`researches/09`), the
NVAPI write path (`researches/05`). This document assumes all three.

---

## 1. The requirement

### 1.1 The owner's words, verbatim

> *«Давай еще запланируем тестовый стенд - мокап, виртуальную GPU, которая имеет свою кривую края и
> отказов. Будет притворяться реальной GPU, и будет использоваться нами для тестирования движка ДО
> того, как будем движок гонять на реальной карте.*
>
> *Для тестов на виртуальной карте будем делать ускоренные в 10 раз прожиги: быстрые 1 секунда,
> длинные 6 секунд.»*

And the form, given the same evening:

> *«стенд виртуальной 5070 Ti, в общем случае - любой видеокарты. Конкретную модель задаем профилем
> виртуальной карты, у нас это будет наша реальная 5070 Ti, но с некоторыми придуманными краями
> отказа»*

**Five hard requirements fall out, and none of them is negotiable:** the bench has its own edge curve
which the engine must FIND · failure near the edge is PROBABILISTIC, not a threshold · it pretends to
be a real GPU (the engine must not know) · burns are 10× shorter (1 s / 6 s) · the mechanics are
generic and the card is a **profile fixture**.

### 1.2 What `ideas/04` already settled, so the epic does not re-open it

Seven items the owner's document already thought through and which enter this research as INPUTS:
the substitution seam is `profile-manager`'s backend and never a forged `nvidia-smi`/`nvapi64.dll` ·
three outcomes including `ЗАВИС` by process kill · reproducible seeded randomness · acceleration as
an ARGUMENT rather than a code fork · the provability boundary printed by the bench itself · traps
that the bench must go red on · what the bench buys beyond debugging.

**§2 below either confirms each of these against industry practice or contradicts it.** That is the
whole reason the sweep was run: an idea confirmed by the field is a decision; an idea confirmed by
the agent that had it is a preference.

---

## 2. The industry sweep

### 2.1 This has a name: **deterministic simulation testing** (DST)

The problem — *"a system whose correctness depends on surviving crashes, which is too expensive and
too destructive to exercise against the real world"* — is exactly the problem FoundationDB solved,
and its lineage is the most mature in the field.

| System | What it simulates | The reproducibility unit |
|---|---|---|
| **FoundationDB** | a whole cluster on ONE thread: simulated disks, networks, machine crashes; ~10¹² CPU-hours of simulated testing accumulated | the seed |
| **TigerBeetle (VOPR)** | a cluster with injected network, disk and process faults; *"compresses months of simulated operation into minutes of wall-clock"* | **seed + git commit** |
| **Antithesis** | a deterministic hypervisor running unmodified systems under injected faults — built by the FoundationDB people | the seed |
| **WarpStream** | DST applied to an entire commercial SaaS | the seed |

Four practices are stated identically by all of them, and each one lands directly on `ideas/04`:

1. **One seed controls ALL nondeterminism** — time, randomness, I/O ordering. *"Same seed, same
   execution, same bug, every time."* Any randomness that escapes the seed destroys the property.
   → confirms `ideas/04` §3, and sharpens it: the seed must be the ONLY source, not one source.
2. **Reproduction takes the seed AND the code version.** TigerBeetle records the git commit beside
   the seed. → an addition the idea did not have: a bench report carrying only the seed is not
   reproducible after the next commit.
3. **Time is compressed deliberately** — the value of the simulator is that months become minutes.
   → confirms the owner's 10× directly, and §2.4 says how the field does it cleanly.
4. **Many seeds, not one run.** A single green seed proves one interleaving. → the epic needs a
   multi-seed sweep mode, which `ideas/04` did not name.

### 2.2 The failure mode of every fake, and the industry's one answer: **the contract test**

This is the most important finding in this document, because it turns `ideas/04` §5 (*"a green mock
is not a statement about your card"*) from a warning into a mechanism.

A test double is only worth what its FIDELITY is worth, and fidelity rots silently: the real thing
changes, the fake does not, and the suite stays green. The industry's answer is not discipline —
it is a **contract test**: *"periodically run the same contract test suite against both the fake and
the real implementation to catch drift"*, so that a divergence is a red test rather than a
production surprise, and every discovered inconsistency becomes one more case in the shared suite.

**Applied here, this is exactly the truth↔mirror registry the project already runs**
(`AGENT_GUIDE.md`): the truth is the live card's backend, the mirror is the virtual card, and the
check is one suite that both must satisfy. The registry's own test of a REAL pair (EXP-0013 — the
two sides must have different AUTHORS) is satisfied: the driver wrote one side, we write the other.

The taxonomy is also worth using precisely, because the project's existing doubles are the wrong
kind: a **stub** answers canned values for one test, a **fake** is a working implementation with a
shortcut. What the owner asked for is a **fake** — a card that actually behaves like a card — and
fakes are the one double type that earns a contract test.

### 2.3 Crash injection and crash-consistency testing

The `ЗАВИС` path has a name too. Crash-consistency testing *"injects crashes at selected persistence
boundaries and validates post-recovery states against expected correctness semantics"*, and the
literature's headline warning is directly relevant to `plans/15` §4.4:

> *"Recovery failures are often more damaging than the original fault — a system that survives a
> failure but never fully recovers is a system that degrades with every incident."*

Two practices to steal:

- **The crash is injected AT a persistence boundary**, not at a random instant — that is what makes
  the test meaningful and repeatable. For the sweep, the boundaries are named already: between the
  journal's `intent` write and the card write; between the card write and the `verdict` write.
- **The assertion is on the POST-RECOVERY state**, not on the crash. The bench's job is not to kill
  the process; it is to let the next launch be examined.

### 2.4 Virtual time — how the field accelerates without forking the code

The owner's 10× has a canonical implementation, and it is not a flag inside the engine:

> *"Don't access the system clock directly. Wrap calls to the system clock into a Clock object, and
> replace it with a Virtual Clock for testing."* · *"If there's a 30-second timeout, the virtual
> clock just jumps ahead by 30 seconds."*

**This CONFIRMS `ideas/04` §4 and improves it.** The idea said: durations stay arguments, the bench
passes different numbers. The field says the same thing more strongly — the code under test must not
read the wall clock at all where the simulation needs control. For KAGO that distinction is small but
real: the engine's burn duration is already an argument (`--seconds`, `--sustain`), so the owner's
1 s / 6 s need no new machinery; but the engine also *waits* (read-back settling, `sleep`s in
`profile-manager`'s `timing`), and those are wall-clock. The existing code already anticipated this —
`profile-manager`'s selftests pass a `FAST` timing object — which is the virtual-clock pattern
arriving early by accident.

### 2.5 What the silicon model must not contradict

The bench invents an edge; it must not invent PHYSICS. Three published facts bound the model:

- **Below Vmin the fault rate rises exponentially**, and Vmin *"separates the fault-free (voltage
  guardband) region from the faulty region"*. The project's own number from `researches/02` is the
  sharp form: the error rate goes **3 % → 90 % across 2 % of voltage**.
- **The characterization instrument is the shmoo plot** — pass/fail over a parameter sweep, exactly
  the artifact the sweep engine produces. The bench's edge curve is a shmoo boundary the engine must
  rediscover.
- **Vmin is found probabilistically in industry too** — Monte Carlo with importance sampling to find
  the most probable failure point. Nobody treats the edge as a threshold; neither may the bench.
  This card has already shown both outcomes at one voltage (fact 28's history).

**The arithmetic this forces, computed here so the epic does not re-derive it.** Fit a logistic to
the project's own 3 % → 90 % over 2 % of voltage. At ≈1000 mV that span is 20 mV, and
`logit(0.90) − logit(0.03) = 2.197 − (−3.476) = 5.673`, so the scale is `20 / 5.673 ≈ 3.5 mV`.
**Consequence: one 5 mV grid step moves the failure probability from ≈0.20 to ≈0.80.** That is the
number that makes the bench realistic — an edge one grid step wide, not a cliff and not a ramp.

### 2.6 Anti-patterns the industry has already abandoned — worth naming so nobody rediscovers them

| Anti-pattern | Why it is abandoned | Where it would have bitten us |
|---|---|---|
| Faking the vendor's binaries / drivers | you end up maintaining a second driver, and its bugs are indistinguishable from yours | `ideas/04` §1 already refused it; the field agrees |
| A code path that only exists under the mock (`if (mock) …`) | what you proved is not what ships | the 10× would have been the first such flag |
| Randomness outside the seed | "sometimes red" — the worst instrument there is | timestamps, `Math.random`, map iteration order |
| A fake with no contract test | drift is silent and green | the three hand-rolled doubles in §3.2 |
| One green seed treated as proof | proves one interleaving | a single bench run in the epic's gate |
| Simulation replacing on-target testing | host simulation catches LOGIC bugs; hardware testing *"stays essential but focuses on integration"* | the whole provability boundary |

---

## 3. Local recon — what this repository actually contains today

*(read from the tree on 2026-08-15, not recalled)*

### 3.1 The seam the owner guessed is real, and it is two seams, not one

| Seam | Where | Shape |
|---|---|---|
| **The card backend** | `automation-engine/lib/profile-manager.mjs:92–129` — *"R2's seam. Four semantic methods"* | `query(fields)` · `setPowerLimitWatts(w)` · `lockGraphicsClocksMhz(min,max)` · `resetGraphicsClocks()` |
| **The curve backend** | `profile-manager.mjs:161–268` (`nvapiCurveBackend`) | `writeRaiseAndCap(Δ, cap, {cardMaxClockMhz})` · `readCurveOffsets()` · `zeroCurve()` · `close()` |
| **The oracle** | `stress-tester.mjs:585` — `judgeCandidate({ runShapeFn })`, and it *throws* if `runShapeFn` is absent | one function per shape → `{verdict, reason, meters}` |

**Three seams, all already injectable, none requiring a new abstraction.** The bench is an
implementation of these three interfaces plus a fixture. `ideas/04` §1 called this correctly.

### 3.2 The project already has hand-rolled doubles — three of them, and none is a card

| Double | File | What it models |
|---|---|---|
| `fakeBackend` | `profile-manager.mjs:941` | stale reads, a clock that FLASHES the target, lying success text, injected failure — *a liar*, not a card |
| `fakeBackend` | `ladder-descent.mjs:394` | lock fails / reset fails / a remembered lock — *a second, different liar* |
| `fakeCurve` | `profile-manager.mjs:1384` | write ok, reads back same/different, zero ok |

They are **stubs in the §2.2 taxonomy**: each answers what its own suite needs, none has state that
behaves like silicon, and no two agree. This is a finding, not a complaint — it means the epic's
first deliverable has an existing constituency, and that consolidating them is a DRY win the internal
map should record. It also means the bench must not break them: they encode paid-for lessons (a
read-back that flashes the target for one sample is EXP-0014's incident).

### 3.3 What `plans/15` will demand of the bench, criterion by criterion

The bench exists to serve phase 2 of epic 02. Reading that plan against the bench's capabilities
gives the epic its real acceptance list — this is the mapping, and it is the reason the bench is
worth building at all:

| Phase-2 criterion | What it needs from a virtual card |
|---|---|
| F2-AC1 (step ladder) | a **non-uniform voltage grid** — the real one, 5 mV ×94 and 10 mV ×32 |
| F2-AC2 (governor generalized) | nothing — pure function |
| F2-AC3 (seeding proved) | a card whose Vmin is **non-monotone somewhere** — otherwise the rejection path is never taken |
| F2-AC4 (a hang loses nothing) | **the card kills the process** mid-rung, at a named boundary |
| F2-AC5 (two crashes stop the sweep) | the same card, twice, deterministically → the SEED |
| F2-AC6 (5 mV refinement) | a **probabilistic** edge — a threshold card would make refinement trivial and prove nothing |
| F2-AC7 (`lever-limited` ≠ `edge-found`) | a card whose edge sits BELOW the ±1000 MHz lever wall in the mid-range |
| F2-AC8 (dry run == real run) | a full scripted sweep, minutes not hours |
| F2-AC9 (the ceiling's holder) | the geometry: `top − 1000` must be a real number the card reports |
| F2-AC10 (zero GPU writes) | the whole point |

**Six of the ten cannot be exercised at all without the bench.** That is the epic's justification in
one line, and it is measured rather than argued.

### 3.4 The first virtual card's geometry is already on disk, written by epic 02 phase 1

| Artifact | Contents |
|---|---|
| `curves/voltage-grid.json` | 127 values, 450…1240 mV, `spacingsMv: [{5, ×94}, {10, ×32}]`, `uniform: false`, card `{name, maxGraphicsMhz: 3090}`, stamp `{driver 610.88, vbios 98.03.58.40.8b}` |
| `curves/frequency-grid.json` | 389 values descending, 180…3090 MHz, `stepsMhz: [{7, ×194}, {8, ×194}]` |
| `curves/measured.json` | the tuning-curve document: 389 rows `{mhz, voltageMv, stockVoltageMv, status, provenBy, editedAt}`, all `status: "stock"` today |

**So a card profile is these three shapes plus one new field — the invented edge.** Nothing has to be
authored from scratch, and the "any video card" generality the owner asked for is free: a second
profile is a second set of grids.

### 3.5 Lessons already paid for that constrain the design

| Lesson | Constraint on the bench |
|---|---|
| **EXP-0008** — a check that has never gone red proves nothing | the bench ships with trap cards, and each trap must redden a NAMED block |
| **EXP-0016** — mutation addressees named BEFORE the run | the epic's suites name theirs in the header |
| **EXP-0025** — a selftest must not write into the production directory | the bench's journal/curve writes go to a sandbox, asserted |
| **EXP-0013** — a real pair has two different AUTHORS | the contract suite is a real pair; a bench checked only against itself is not |
| **EXP-0011** — a value is only true under the conditions it was taken | every bench report carries seed, commit, card profile, durations |
| **`bugs/09` / EXP-0052** — a bound added to the RUN is not added until the PLAN prints it | the bench must be drivable by `--dry-run` too |

---

## 4. Implications — what this forces the epic to be

### 4.1 Shape: mechanics + card profile, exactly as the owner specified

```
virtual-gpu.mjs        the MECHANICS — one implementation for every card
   ├── cardBackend()      implements the four semantic methods
   ├── curveBackend()     implements the four curve methods
   ├── oracle()           implements runShapeFn — consults the true edge + the failure model
   └── outcomes           PASS · SDC · CRASH · ЗАВИС (process death)

cards/<name>.json      the CARD — geometry + invented edge + failure-model parameters
```

The engine receives three injected objects and cannot tell them from the real ones — which is the
owner's requirement 3, satisfied structurally rather than by effort.

### 4.2 The failure model: the minimal working one, and what it does NOT model

*(this is the one decision `ideas/04` reserved for planning; the agent proposes and names the gap,
per that document's own instruction)*

**The model, three parameters per frequency:**

```
edgeMv(f)                the true edge — below it, failures begin
p_fail = 1 − exp(−λ · t · shapeFactor)      λ = hazard rate, t = burn seconds
λ(V)   = λmax / (1 + exp((V − edgeMv) / 3.5 mV))      ← §2.5's logistic, project's own numbers
outcome class by depth:  shallow → SDC · deeper → CRASH · deepest → ЗАВИС
```

**Why each piece is there and not more:** the logistic with scale 3.5 mV IS the project's measured
3 % → 90 % over 2 % of voltage (§2.5) · duration enters as a hazard rate so a shortened burn honestly
finds fewer failures — which is the accelerated bench telling the truth about its own acceleration ·
`shapeFactor` gives `--transient` its higher yield, the reason it is judged first · the depth-ordered
outcome classes are what make `ЗАВИС` reachable without a special case.

**What it does NOT model, named out loud so no report ever implies otherwise:** temperature (a warmer
card wants more voltage for the same frequency — measured, and deliberately absent here) · the
~100 mV Vmin spread BETWEEN programs (`researches/02`) beyond one scalar `shapeFactor` · silicon
aging and drift · the memory domain · clock stretching and ECC replay (`researches/04`) · the
driver's real write semantics, latency and refusals · anything about how a pin actually behaves.

**And the load-bearing sentence, which belongs in the bench's own output:** the numbers a virtual
card produces are not a hypothesis about the owner's card. They exist so the engine has something to
find.

### 4.3 The contract suite is the epic's real deliverable, not the mock

From §2.2: a fake without a contract test is the anti-pattern. So the epic ships **one suite over the
three interfaces, run twice** — against the virtual card (offline, every commit) and against the live
card (read-only assertions plus the writes the project already performs, at phase gates). Drift
becomes a red test instead of a false green, and the provability boundary stops being a paragraph
nobody executes.

This also gives `TESTING_FRAMEWORK.md` something it currently lacks: a mechanism for "the simulation
proves logic, the hardware proves integration" (§2.6's last row) rather than an honourable intention.

### 4.4 Seed, and the reproduction unit

Seed is an argument, printed in every report — and **the report also carries the git commit**
(TigerBeetle's practice, §2.1), plus the card profile's own hash. A run reproduced by seed alone
after a code change is not reproduced.

### 4.5 Acceleration: 1 s / 6 s as arguments, and one thing to prove

The owner's 10× is passed to the same `--seconds` / `--sustain` the live engine takes. **The epic must
prove this rather than assert it:** a block that diffs the live invocation and the bench invocation
and shows they differ ONLY in argument values — no `if (virtual)` anywhere in the engine. That is
`ideas/04` §4 made checkable.

### 4.6 Trap cards — the bench proves itself red before anyone trusts its green

`ideas/04` §6 named four; §3.3 shows they are exactly the phase-2 criteria that are otherwise
unreachable. Each trap is a CARD FILE, not a code branch — which is the generality paying for itself:

| Trap card | The engine must | Otherwise |
|---|---|---|
| edge above the descent's reach | stop, report `edge-found` at the first rung | it walks past the edge |
| hangs at a fixed rung | name that rung after re-launch, mark `ЗАВИС` | the journal is decorative |
| **non-monotone Vmin** | reject the seed, restart from stock, PRINT it | the owner's rare case is silently absorbed |
| edge below the lever wall | report `lever-limited` | a false `[TESTED]` |
| hangs twice on the same rung | refuse the third attempt, exit non-zero | infinite loop on the owner's machine |

### 4.7 The bench measures the engine, too

`researches/09` estimated the sweep at ≈1.7 h with seeding against 13 h without and 67 h naive.
**Those are arithmetic, and the bench turns them into measurements** — rung counts on a known edge,
per band, in minutes. An estimate that is never checked is a number that drifts.

---

## 5. Open forks for the owner

**None.** `ideas/04` reserved exactly one decision — the failure model's depth — and instructed the
agent to propose the minimal working one and name what it omits. §4.2 does both. Everything else is
method, which is the agent's work by standing rule (EXP-0026).

One thing the owner will want to SEE rather than decide: the first virtual card's invented edge
curve, because it is the only fictional number in the epic. It ships as a plot-shaped table in the
bench's report next to what the engine found.

---

## 6. Sources

Industry practice:

- [Deterministic simulation testing — Antithesis](https://antithesis.com/docs/resources/deterministic_simulation_testing/)
- [TigerBeetle VOPR — the simulator, seed + commit reproduction](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md)
- [Deterministic Simulation Testing for Our Entire SaaS — WarpStream](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas)
- [Building an open-source Antithesis, part 1 — the DST ecosystem](https://databases.systems/posts/open-source-antithesis-p1)
- [Awesome deterministic simulation testing (curated list)](https://github.com/ivanyu/awesome-deterministic-simulation-testing)
- [Deterministic simulation testing for async Rust — S2](https://s2.dev/blog/dst)
- [Contract tests ensure faithful doubles](https://www.goodreads.com/author_blog_posts/16437547-contract-tests-ensure-faithful-doubles)
- [Fake, don't mock — Shai Yallin](https://www.shaiyallin.com/post/fake-don-t-mock/)
- [The practical test pyramid — Fowler](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Testing storage-system correctness: crash-consistency and crash injection (arXiv)](https://arxiv.org/pdf/2602.02614)
- [Fault injection testing — Microsoft engineering playbook](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/fault-injection-testing/)
- [The virtual clock test pattern](http://ducktypo.blogspot.com/2013/12/the-virtual-clock-test-pattern.html)
- [Decouple application logic from hardware — why most embedded engineers get simulation wrong](https://www.designnews.com/embedded-systems/decouple-application-logic-from-hardware-to-unlock-faster-firmware-testing-and-smarter-development)
- [Automated driver testing for small-footprint embedded systems (arXiv)](https://arxiv.org/pdf/2105.01451)

Silicon:

- [Shmoo plot](https://grokipedia.com/page/Shmoo_plot)
- [Evaluating built-in ECC of FPGA on-chip memories for the mitigation of undervolting faults (arXiv)](https://arxiv.org/pdf/1903.12514)
- [Dynamic stability in minimum operating voltage Vmin](https://www.researchgate.net/publication/220910542_Dynamic_stability_in_minimum_operating_voltage_Vmin_for_single-port_and_dual-port_SRAMs)

Local (this repository, read 2026-08-15): `profile-manager.mjs:92`, `:161`, `:941`, `:1384` ·
`ladder-descent.mjs:394` · `stress-tester.mjs:585` · `curves/*.json` · `plans/15` · `researches/02`
§2 · `researches/09` §3–§4 · `EXPERIENCE.md` EXP-0008, EXP-0011, EXP-0013, EXP-0014, EXP-0016,
EXP-0025, EXP-0052.
