# Plan 21 — a burn that reaches the card's power limit and still answers the oracle

> **Created:** 2026-08-16 (on the owner's direct instruction, chat 23:0x +03:00)
> **Parent:** `GOAL.md` → «🔥 ЧТО ТАКОЕ ПРОЖИГ» → «Критерий приёмки прожига назван числом» ·
> `interviews/008` (closed, variant A: fix what we can, leave RT alone)
> **Status:** 🔲 not started — the card is busy with the live sweep; measurement is step 1
> **Outbound:** the measured power-per-shape table belongs in `STATUS.md` as a fact; a shape that
> reaches the limit changes `workloads/MANIFEST.json` and every golden reference

## Goal vector

**The pain:** a rung's verdict is produced by a burn that loads the card to **45 % of its envelope**
(135,8 W measured against a 300 W limit, duty 56,1 %). Every voltage this project has proven is
therefore proven under half the electrical stress the owner's games apply — STATUS fact 16, now
confirmed a fourth time. A profile qualified this way is qualified against the wrong load.

**Where we want to be:** the owner's words, verbatim (2026-08-16 23:0x): *«Видеокарта в эти 10
секунд должна УПИРАТЬСЯ В ПРЕДЕЛ ПОТРЕБЛЕНИЯ ЭЛЕКТРОЭНЕРГИИ»* · *«она должна молотить расчёты как
бешенная»* · *«стресс нагрузка на 10 секунд»* — and, on the oracle half: *«нужно придумать тип
нагрузки, которая сильно в потолок загружает карту, и даёт ценный результат для оракула, который
видит, есть искажения в работе GPU, или нет искажений»*.

**Goal type:** Achieve. The duration does not grow; the density does.

## Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **B1** | The burn holds the card at its power limit | Scale: watts, median over the loaded window · Meter: `npm run power -- --capture` from a SEPARATE sampler process · Target: **≥ 285 W of a 300 W limit**, i.e. within the meter's own scatter of the cap |
| **B2** | The card is not idle inside the burn | Scale: duty factor `gpu_us/wall_us` reported by the workload AND `utilization.gpu` read independently · Meter: the two must agree (the cross-check that made the 2026-08-10 number trustworthy) · Target: **≥ 95 %** |
| **B3** | Determinism survives | Scale: distinct checksums over 5 runs at stock · Meter: `npm run workloads:build` · Target: **exactly 1** |
| **B4** | The graded oracle still measures | Scale: the five-number tuple on an injected single-bit flip · Meter: `npm run prove:gradient` against the NEW kernel · Target: `distinct=2 · bad_launches=1 · bad_elems_max=1 · bit_dist_min=1 · first_bad_index=<injected>` |
| **B5** | VRAM is actually exercised | Scale: bytes moved per second, derived from the kernel's own counters · Meter: the workload's own line · Target: **> 0** — today it is exactly zero, and that is the coverage hole, not a performance note |
| **B6** | The rung does not get slower | Scale: seconds per rung · Meter: the sweep journal's intent→verdict median (**14,0 s today**) · Target: **≤ 14,0 s** |

## Why the present shape falls short — measured, not assumed

`fma_chain` is a pure register FMA chain: `acc = acc * 1.0000001f + 0.0000001f`, seeded from the
thread index, one store per thread per launch. **It reads nothing from memory at all.** After every
launch the whole buffer is copied to the host and hashed byte-by-byte with FNV-1a, and the card
stands idle for the whole of it.

Two consequences, and the second is the one that matters most:

1. **Power.** 137,9 W average at 56,3 % duty. Unfolding it against this card's measured idle floor
   (21,8–30 W): `0,563·P + 0,437·25 ≈ 137,9` → **P ≈ 225 W while the kernel is actually running.**
   So the arithmetic itself is not weak — the gaps are what pull the average down. Fixing duty alone
   projects to ~225 W, i.e. **75 W short of B1**, which is why occupancy and memory traffic are in
   the design rather than optional.
2. **Oracle coverage.** A kernel that never reads memory is **blind to VRAM corruption by
   construction** — there is nothing there for us to find. This is the owner's «ценный результат для
   оракула» half, and it is an argument that stands with no reference to watts.

Reference points on this same card, both measured 2026-08-10:

| load | duty | power (limit 300 W) |
|---|---|---|
| `sdc_fma` — the only one the sweep uses | 56 % | 137,9 W |
| `branchy` — saturating, pointer chase + divergence | **98,5 %** | **194,8 W** |
| Q2RTX (a real game) | — | **299,97 W**, throttling on `sw_power_cap` |

**`branchy` is the decisive datum: 98,5 % duty and still 105 W short.** Duty is necessary and not
sufficient; the missing watts live in units neither of our loads touches.

## The design — three power sources in one kernel, because draw is roughly additive across units

| source | what it does | how determinism is kept |
|---|---|---|
| **the FMA chain** | as today, at FULL occupancy | each thread owns its slot; order is irrelevant |
| **a deterministic VRAM stream** | each thread reads its own fixed set of addresses from a large table and folds what it read into its accumulator | **the table is built on the HOST from a fixed seed** — the technique is already paid for in `branchy`: a table filled BY the card under test would carry that card's corruption and it would look like ours |
| **occupancy** | today `256 × 256 = 65 536` threads against a card that holds ≈ 143 000 concurrently — **we load about half the machine** | changes no arithmetic at all; it is the cheapest of the three levers and needs no new code, only a different default |

**The duty fix, separately from the three above:** overlap the host hash with the NEXT launch
(two device buffers + a CUDA stream). This keeps the checksum byte-identical — the same FNV-1a over
the same bytes in the same order — so it changes scheduling and not the measured quantity.

## Boundaries — what this must NOT do, so the oracle survives

- **No atomics, no reductions whose order depends on scheduling.** The whole trust contract rests on
  it (`sdc_fma.cu` header).
- **The checksum stays on the HOST.** A GPU-side reduction would have to survive the very corruption
  it exists to detect. The 44 % idle was the price of that honesty; the fix is to overlap it, never
  to move it onto the card.
- **No `-use_fast_math`** — reassociation between builds would move the checksum for a reason that is
  not the silicon.
- **The table is never filled by the GPU.**
- **RT cores stay out of scope** — the owner's decision, `interviews/008` variant A, verbatim
  *«A — чини что умеешь, RT не трогай»*. B1 may therefore prove unreachable without them; if the
  measurement says so, that is a FINDING to report, not a criterion to quietly soften.

## Steps

- [ ] **1. MEASURE FIRST, code second.** A grid — occupancy × chain length × memory-stream volume —
      against watts, using the existing positional arguments (`iters blocks threads`) and
      `npm run power -- --capture`. No source change is needed to run it. Which shape reaches the
      limit is a question for the card, not for reasoning.
- [ ] **2. Write the grid's result into `STATUS.md` as a fact**, whatever it says — including
      «the limit is unreachable without memory traffic / without RT», if that is the answer.
- [ ] **3. Bake the winning shape into the DEFAULTS**, not into an argument someone must remember to
      type (EXP-0078: a rule that lives in an argument's value is a hope with a citation).
- [ ] **4. Overlap the hash** (two buffers + stream) and re-prove B2 by the two-instrument agreement.
- [ ] **5. Add the deterministic VRAM stream** if step 1 says the limit needs it.
- [ ] **6. Re-capture the goldens and the manifest** — B3 by five runs, and say out loud in the
      commit that every previously recorded verdict was taken against the OLD load.
- [ ] **7. Re-prove the graded oracle on the NEW kernel** (B4) — `npm run prove:gradient` rebuilds
      the corrupt copy; the shipped binary carries no corruption hook.
- [ ] **8. Re-measure seconds per rung** (B6) against the journal's present 14,0 s.

## Risks

- **(a) HIGH — B1 may be unreachable inside the owner's own boundary.** `branchy` at 98,5 % duty
  reaches 194,8 W; the game reaches 300 W partly through ray tracing, which variant A excludes. The
  contingency is to report the measured ceiling honestly and put the gap back to the owner as a
  question, never to relabel a lower number as success.
- **(b) HIGH — every existing golden and every recorded verdict belongs to the OLD load.** A changed
  kernel invalidates them by construction (R6's shape, applied to the workload instead of the
  driver). Step 6 is not bookkeeping; skipping it would make every future PASS a comparison against
  a reference nobody re-took.
- **(c) MEDIUM — ⚠️ THE BINARY MAY NOT BE REBUILT WHILE A SWEEP IS RUNNING.** `npm run workloads:build`
  overwrites `sdc_fma.exe`, which the live sweep launches every 14 s; every verdict it produced after
  such an overwrite would be a claim about a program that no longer exists. Check
  `npm run watchdog -- --status` and the running processes before building.
- **(d) MEDIUM — a heavier burn changes the THERMAL picture of the sweep**, so rungs measured before
  and after are not directly comparable. This is a real cost of doing the right thing, and it is
  named here so a later session does not read the two halves of the document as one series.
- **(e) LOW — higher occupancy may change the kernel's own timing enough to move the checksum** if
  anything in the chain were order-dependent. Nothing is, by construction; B3 is what proves it
  rather than assumes it.
