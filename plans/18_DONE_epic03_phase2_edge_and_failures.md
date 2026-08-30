# Plan 18 — Epic 03 / Phase 2: the invented edge, the probabilistic failure, and the three outcomes

> **Created:** 2026-08-15 19:0x +03:00 (agent, written at phase 1's closure as the ladder requires,
> and prompted by the owner's question in chat — *«А ты заложил искуственную границу, край, который
> притворяется отказами?»* — which is exactly this phase)
> **Parent:** `plans/16_EPIC_virtual_gpu_bench.md` — phase 2. Evidence base: `researches/10` §4.2 (the
> model and what it omits) · `researches/02` (the physics it must not contradict) · `plans/17` (the
> card this fills the `fiction` block of)
> **Status:** 🔲 open · **ZERO GPU WRITES** · no owner needed
> **Outbound:** the outcome vocabulary → `plans/15` §4.3–4.4 (the sweep engine consumes it) · the
> provability boundary in reports → `TESTING_FRAMEWORK.md` · closure → `plans/16` §4

---

## 1. Goal vector

**The pain.** Phase 1's card cannot fail. Every criterion of the sweep engine that matters — the
5 mV refinement, `lever-limited` versus `edge-found`, the seeding rejection, the write-ahead journal,
the two-crash stop — needs a card that HAS an edge and fails NEAR it the way silicon does.

**Where we want to be.** The card carries a true edge per frequency that the engine does not know
and must find; below it failures arrive with a probability that rises steeply rather than as a
threshold; the outcome is `SDC`, `CRASH` or a real `ЗАВИС`; and the same seed reproduces the run
byte for byte.

**Goal types.** *Achieve* — `fiction` filled and an oracle over it. *Maintain* — no randomness outside
the seed, the provability line in every report, zero GPU writes. *Avoid* — a deterministic threshold
edge, which would let an engine pass here and die on real silicon.

## 2. Entry gate

Phase 1 closed (`npm run vgpu -- --selftest` → 37/0, 8 mutations) · `npm run check` green.

## 3. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **B2-AC1** | The edge is DEFINED, not hand-waved, and the definition is in the artifact. | Scale: frequencies without an edge voltage · Meter: the card's `fiction.edge` · **Target: 0 for every frequency of the grid; the definition — «the voltage at which a 10 s burn fails half the time» — is written in the file** |
| **B2-AC2** | Failure is PROBABILISTIC with the steepness the project measured. | Scale: modelled failure probability one grid step above and below the edge · Meter: an arithmetic block · **Target: ≈0.2 above and ≈0.8 below at 5 mV — the logistic fitted to 3 % → 90 % across 2 % of voltage (`researches/02`)** |
| **B2-AC3** | Duration matters, so an accelerated burn honestly finds less. | Scale: failure probability at 1 s versus 10 s at the same voltage · Meter: the same block · **Target: strictly lower at 1 s, and the report says so rather than implying the speed-up is free** |
| **B2-AC4** | The outcome class deepens with depth: `SDC` → `CRASH` → `ЗАВИС`. | Scale: outcomes drawn at three depths · Meter: a seeded block · **Target: each depth yields its class; no class is unreachable** |
| **B2-AC5** | `ЗАВИС` is a REAL process death — no `finally` runs. | Scale: cleanup handlers that ran on a hang · Meter: a CHILD process really dies; the parent reads what it managed to write · **Target: 0 handlers ran, and the parent can still name the last intent on disk** |
| **B2-AC6** | The same seed reproduces the run exactly; the report names the reproduction unit. | Scale: differing outcomes between two runs at one seed · Meter: two scripted sweeps diffed · **Target: 0, and every report carries seed + commit + card hash** |
| **B2-AC7** | The engine's REAL verdict logic judges, not a stand-in. | Scale: verdict decisions made by the bench instead of by `stress-tester` · Meter: the seam is `runBurst({run})` plus a fixture baseline dir · **Target: 0 — the bench produces a burst RESULT, the real code produces the verdict** |
| **B2-AC8** | Every new guard proved able to fail. | Scale: mutations reddening their own named block · **Target: 100 %, addressees named before the run** |

## 4. Steps

### 4.1 — The edge curve as fiction with a stated shape 🔲

- [ ] `fiction.edge`: for every frequency of the grid, the true failure voltage, snapped to the card's
      voltage grid, generated from anchors and interpolation — never typed.
- [ ] **The shape is chosen so the engine's hard cases are REACHABLE**, which is the whole point of
      choosing it rather than randomising it: deep headroom at the top and bottom of the range
      (the edge is findable) and headroom DEEPER than the ±1000 MHz lever in the middle (so
      `lever-limited` happens naturally, not only on a trap card).
- [ ] Monotone non-decreasing with frequency by default — Vmin does not fall as frequency rises
      (`researches/09` §2.3) — with the non-monotone case reserved for a trap card in phase 3.
- [ ] The file says, in its own text, that these numbers are invented.

### 4.2 — The failure model 🔲

- [ ] `λ(V) = λmax / (1 + exp((V − edgeMv) / scaleMv))`, `scaleMv = 3.5` from the project's own
      3 % → 90 % over 2 % fit (`researches/10` §2.5).
- [ ] `λmax` fixed BY THE DEFINITION of the edge: a 10 s burn at exactly the edge fails with
      probability 0.5 → `λmax = 2·ln2/10 ≈ 0.1386 s⁻¹`. The definition and the constant are one thing,
      so neither can drift from the other.
- [ ] `p(fail) = 1 − exp(−λ(V) · seconds · shapeFactor)`; `shapeFactor` > 1 for `--transient`, which is
      why that shape is judged first on the real card.

### 4.3 — Three outcomes 🔲

- [ ] Depth below the edge decides the class: shallow → `SDC` · deeper → `CRASH` · deepest → `ЗАВИС`.
      Thresholds live in `fiction.failure`, so a trap card can move them without touching code.
- [ ] `SDC` = a checksum that differs from the golden (or `distinct > 1` inside one burst — the
      sustained shape's own detector). `CRASH` = a non-zero exit. `ЗАВИС` = `process.exit()`.
- [ ] **Process death is ARMED, not default:** `allowProcessDeath` must be passed, because a suite
      whose oracle can kill the runner cannot report its own results. The drill spawns a child.

### 4.4 — The seam and the seed 🔲

- [ ] The card supplies `run(binary, argv)` for `runBurst({run})`, printing a real `KAGO-WORKLOAD`
      line, and a fixture baseline dir under `runs/` so the REAL `stressTest` computes the verdict.
- [ ] `mulberry32`, seeded by argument, self-tested against a fixed sequence. Nothing else may be
      a source of randomness.
- [ ] Every report: seed, git commit, card-profile hash, and the provability line.

### 4.5 — Selftests and mutations 🔲

Addressees named in the suite header before the run: flatten the logistic · make the edge a threshold ·
drop `seconds` from the hazard · make every outcome `SDC` · let `ЗАВИС` return instead of dying ·
reseed from the clock · let the bench decide the verdict itself.

## 5. What phase 2 does NOT do

Trap cards and the contract suite (phase 3) · any change to `engine.mjs` · anything on the real card.

## 6. Decisions made without the owner

- **The edge is DEFINED as «a 10 s burn fails half the time here»**, because a probabilistic edge has
  no other honest definition — «the voltage below which it fails» describes a threshold, and a
  threshold is exactly what this card must not be.
- **The mid-range edge is placed deeper than the lever can reach.** That makes `lever-limited` an
  ordinary outcome of the ordinary card rather than a curiosity of a trap, which is what the sweep
  engine needs to be exercised against.

---

## ✅ STATUS: DONE (тег поставлен 2026-08-30 18:0x, ревизия беклога сессии 68)

**Что закрыто.** Фаза 2 эпика 03 — придуманный край, вероятностный отказ и три исхода. Исполнена
2026-08-15, тег `DONE` не поставили; предмет `bugs/25`.

**Чем доказано.** Тем же способом, что и фаза 1, и это единственный честный здесь способ: вход
фазы 3 по `plans/16` §4 — «фаза 2 закрыта · `/fable-judge` по фазе 2», а `plans/19_DONE` (фаза 3,
тег стоит) пишет в шапке «entry gate passed 19:5x» и «✅ ИСПОЛНЕНА 2026-08-15 21:4x». Свидетель
закрытия фазы — строка её родителя и ворота следующей фазы, а не маркер внутри неё самой (урок
ревизии `bugs/25`). Второй свидетель — `STATUS.md`, «эпик 03 закрыт целиком, все три фазы».

**Чего этот тег НЕ утверждает.** Закрытия эпика `plans/16` — см. `bugs/25`.
