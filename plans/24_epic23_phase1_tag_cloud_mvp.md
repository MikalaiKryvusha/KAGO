# Plan 24 — Epic 04 / Phase 1: the tag cloud MVP — lossless, behaviour-neutral, nothing new decided

> **Created:** 2026-08-22 20:5x +03:00 (agent, rung 3 of the planning ladder for `plans/23`)
> **Parent:** `plans/23_EPIC_point_tag_cloud.md` — phase 1. Evidence base: `researches/13`
> (local recon · industry sweep · the owner's ask verbatim)
> **Status:** 🔲 open · **ENTRY GATE: `interviews/010` answered — the tag vocabulary is the owner's**
> · **ZERO GPU WRITES for the whole phase** — every step is offline
> **Outbound:** the row format → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R14 (the rule gains its tag
> clause) · re-measured selftest counts → `STATUS.md` · what the format still cannot say → `plans/23`
> phase 3's operational plan, written when this one closes

---

## 0. Goal vector and acceptance criteria

**The pain.** Anchored in the meta-plan: *«в одном поле слиплись четыре независимых факта, и два из
них невыразимы вовсе»*. Full evidence in `researches/13` §1.3.

**Where this phase lands us.** The document stores a tag cloud; every fact it holds today is carried
across unchanged; every consumer still works; and NOTHING new is decided about meaning. This phase is
deliberately the boring one — it earns the right to the interesting ones by proving it moved nothing.

**Goal type:** ACHIEVE the format, MAINTAIN every measured fact and every behaviour.

### Acceptance criteria (Scale · Meter · Target)

| # | Criterion | Scale | Meter | Target |
|---|---|---|---|---|
| P1-AC1 | The production document round-trips losslessly | bytes differing | golden of `curves/measured.json`: read → migrate → render legacy → `diff` | **0** |
| P1-AC2 | The dry run's output is unchanged | lines differing | golden of `engine --sweep --from 2887 --to 2700 --dry-run` before/after | **0** |
| P1-AC3 | The tag vocabulary is CLOSED | unknown tag accepted | `curve --selftest` block + mutation | refused **by name**, 0 accepted |
| P1-AC4 | Mutually-exclusive classes hold | rows carrying two `стоп:*` tags | selftest block + mutation | refused, **0** |
| P1-AC5 | Accumulation works | tags on a row that found its edge then held the long burn | selftest block | **both present** |
| P1-AC6 | No hand-copied vocabulary subset survives | sites subsetting the vocabulary by hand | `grep` + a block that reddens if `seedFor` returns to a list | **0** |
| P1-AC7 | Every row builder migrated | builders in §1 inventory not migrated | the inventory table, ticked row by row | **0** |
| P1-AC8 | The whole battery is green and its numbers re-measured | red sets | `npm run selftest:all` | **0 red**, counts taken from ITS output only |

---

## 1. THE INVENTORY OF ROW BUILDERS — step one, and it is written down before the first edit

This is the step `bugs/24` exists to make mandatory: that migration rewrote the profile FILES and
missed the three places a profile is built in CODE, leaving three suites red for five days. Taken by
`grep` over `automation-engine/`, `tools/`, `benches/` on 2026-08-22 20:5x.

| # | Site | Kind | Migrated? |
|---|---|---|---|
| 1 | `curve-store.mjs:164` — `initCurveDoc` seeds every row at stock | **production** | ☐ |
| 2 | `curve-store.mjs:~791` — the second seeding path | **production** | ☐ |
| 3 | `curve-store.mjs:~498` — `closePoint`, the document's only author (R14a) | **production** | ☐ |
| 4 | `engine.mjs:4389` — `sweepRow` test helper (feeds most fixtures below) | fixture | ☐ |
| 5 | `engine.mjs:3372–3376` — `seedFor` fixture, 5 rows | fixture | ☐ |
| 6 | `engine.mjs:4526 · 4648 · 4672–4707 · 4898` — `closePoint` fixtures | fixture | ☐ |
| 7 | `curve-store.mjs:925 · 940` — its own selftest | fixture | ☐ |
| 8 | `profile-manager.mjs:1789–1792` — the `curveRef` applier's fixture, 4 rows | fixture | ☐ |
| 9 | `trap-suite.mjs:175` — the virtual bench's curve document | fixture | ☐ |

### ⚠️ The inventory already found something, and it changes how step 3 must be done

**Sites 5, 8 and 9 write the status as a STRING LITERAL** (`'edge-found'`, `'lever-limited'`,
`'stock'`), not as `CURVE_STATUS.*`. So a session that migrates by grepping for `CURVE_STATUS` — the
obvious way — **would not see them at all**. That is the `bugs/24` shape exactly: the migration finds
what is written in the vocabulary's own words and misses what was hand-typed.

Consequence for step 3, and it is not optional: the sweep greps for **the literal status VALUES**
(`'stock'`, `'edge-found'`, `'lever-limited'`, `'depth-capped'`, `'short-burn-proved'`,
`'long-burn-proved'`, `'probing'`), not for the constant's name.

One site is deliberately invalid and must STAY invalid: `engine.mjs:4703` passes `'почти-край'` to
prove the vocabulary refuses an unknown value. Its tag-model twin is P1-AC3.

---

## 2. Steps

Each step cites the meta-plan line it executes.

### 4.1 — Fix the vocabulary from the owner's answer
> Anchor: *«`interviews/010` закрыт — словарь тегов ваш, а не мой»* (`plans/23` §3, entry gate).

- ☐ Read the closed `interviews/010`; quote the three answers verbatim into this plan.
- ☐ Write `CURVE_TAGS` in `curve-store.mjs`: frozen, one entry per tag, each carrying its CLASS and
  whether the class is exclusive or cumulative. Every tag's comment says what it MEANS and what fact
  it carries across from the old field.
- **Verification:** the seven old statuses each map to exactly one tag, and the map is total —
  asserted by a block that iterates `CURVE_STATUS` and fails on an unmapped value, so a future
  addition to either side cannot silently go unmapped.

### 4.2 — The format: `tags` in, `status` derived on load
> Anchor: *«старый `status` ВЫВОДИТСЯ при загрузке, а не хранится»* (`plans/23` §2, phase 1).

- ☐ `ROW_KEYS` gains `tags` and (per Q3's answer) loses `status`.
- ☐ `loadCurveDoc` derives the legacy `status` from the row's exclusive `стоп:*` tag — the same shape
  R14c already uses for `offsetMhz`, which is why this is a precedent and not an invention.
- ☐ `validate` refuses: an unknown tag (by name) · two tags of one exclusive class · a row with no
  `стоп:*` tag at all.
- **Verification:** P1-AC3, P1-AC4 as blocks; each mutation-proved red before its green is trusted
  (`BUG_FIXING_FRAMEWORK.md` → Guards).

### 4.3 — Migrate the stored document
> Anchor: *«миграция боевого документа»* (`plans/23` §2, phase 1).

- ☐ Capture the golden FIRST: copy `curves/measured.json` to the scratchpad before anything runs.
- ☐ A migration reads each row, emits its tags, drops `status`; `writeJsonAtomic` as always (R14a).
- ☐ Render the legacy view back and `diff` against the golden.
- **Verification:** P1-AC1 — an EMPTY diff is the proof; "the numbers look the same" is not
  (`AGENT_GUIDE.md` → byte-exact goldens for refactors).

### 4.4 — Migrate the builders, by the §1 list
> Anchor: *«перевод потребителей по списку»* (`plans/23` §2, phase 1) · P1-AC7.

- ☐ Walk §1 rows 1–9 in order, ticking each. Grep by the literal VALUES, per §1's finding.
- ☐ After each site: run that site's own suite, not the whole battery — a red set must name its site.
- **Verification:** P1-AC7 judged BY THE ROWS of the table, never by impression
  (`AGENT_GUIDE.md` → parity inventory: *«no inventory row — no code»*).

### 4.5 — Collapse the hand-copied subset in `seedFor`
> Anchor: *«Ни одного места, где словарь переписан руками»* (`plans/23` §1, E4-AC6).

- ☐ `engine.seedFor`'s `PROVEN = {short-burn-proved, edge-found, long-burn-proved}` becomes a question
  asked of the row's tags, not membership of a list typed out beside the vocabulary.
- ☐ The pair is REMOVED, not watched — the outcome the truth↔mirror registry prefers.
- **Verification:** a block that reddens if the subset returns to a literal list; plus the existing
  `seedFor` blocks (a `lever-limited` neighbour must still not seed) stay green **unchanged** — if
  they needed editing, the migration changed behaviour and step 4.3's premise is false.

### 4.6 — Prove nothing moved
> Anchor: *«Поведение не сдвинулось ни на шаг»* (`plans/23` §1, E4-AC2).

- ☐ Golden the dry run of `--sweep --from 2887 --to 2700 --dry-run` before the phase starts (do this
  at 4.3, alongside the document golden) and diff after.
- ☐ `npm run selftest:all`; every count in `STATUS.md` updated from ITS output only (`bugs/24`'s rule).
- ☐ `/fable-judge` pass over the phase's own claims.
- **Verification:** P1-AC2, P1-AC8.

### 4.7 — Write the format down where the next session will look
> Anchor: *«формат строки → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (правило R14)»* (`plans/23` header).

- ☐ R14 gains its tag clause: the vocabulary is closed, classes are exclusive or cumulative, the
  legacy status is derived and never stored.
- ☐ `STATUS.md` — one line on what a row can now say that it could not.
- ☐ `EXPERIENCE.md` — the lesson, if the migration teaches one (§3 risk 1 is the likely candidate).

---

## 3. Risks — tiered, per `PHILOSOPHY.md` → Murphy

| Tier | Risk | Contingency |
|---|---|---|
| **(a) highest** | A builder is missed and a suite stays red unnoticed — `bugs/24` verbatim | §1's written inventory + grep by literal VALUE not by constant name + `selftest:all` in one command, which did not exist when `bugs/24` happened |
| **(a) highest** | The migration quietly changes behaviour and the goldens are captured too late to notice | goldens captured in 4.3 **before** the first edit; both are byte-exact diffs, not judgement calls |
| (b) plausible | The derived-status view becomes a second truth someone starts writing to | the derivation is one function, read-only by construction; a block asserts `tags` is the only stored carrier — `status` absent from `ROW_KEYS` makes writing it a refusal |
| (b) plausible | The owner's answer to Q1 is B (flat cloud), and P1-AC4 becomes unwritable | then P1-AC4 is struck with his answer quoted beside it — an acceptance criterion removed by the owner's decision is an edit, not a failure (`REQUIREMENTS_FRAMEWORK.md`) |
| (c) noted | Tag names in Russian collide with the encoding guard | `npm run check` scans every text file for encoding corruption; it already runs in the battery |

---

## 4. What this phase does NOT do

- Does not add a suspicion tag, an outlier detector, or any new MEANING — that is phase 3, and it is
  planned when phase 2 (the live run) has taught what the format still cannot say.
- Does not touch the sweep's method, the two frequency verdicts, or the write-ahead journal's own
  outcome vocabulary (`plans/23` §5).
- Does not write to the GPU. Not once.

## 5. Decisions made without the owner

<filled at closing>
