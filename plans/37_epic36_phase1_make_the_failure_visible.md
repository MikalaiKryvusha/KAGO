# Plan 37 — epic 36, phase 1: make the failure VISIBLE

> **Created:** 2026-08-24 (agent)
> **Parent:** `plans/36_EPIC_the_bench_that_can_fail.md` → phase 1 · evidence base `researches/18`
> **Status:** 🟢 in work 2026-08-24 10:1x
> **Outbound:** the discriminator's reading goes into `bugs/50`; `bugs/47` reopened by it

---

## Goal vector

**Pain.** The atom measures the one thing that would name today's defect — every requested offset
against the control struct (`vf-step.mjs:786–839`, `matched === curvePoints`) — and **throws the
result away**. Atom blocks are not printed by the sweep and not journalled, so on `seq 700`, the
rung that mattered, nobody can say whether that block was green or red. `researches/18` §5 needs
exactly that bit to choose between three live hypotheses.

**Where we want to be.** A red block inside the atom is visible in two places that survive the
session: the operator's console while the run happens, and the write-ahead journal afterwards.

**Type:** Achieve. **Anchor in the meta-plan:** *«1 — сделать отказ ВИДИМЫМ … различитель УЖЕ
существует в коде (`vf-step:837`) и был выброшен ровно на той ступени, где был нужен»*.

## Acceptance criteria

| # | Criterion | Meter | Target |
|---|---|---|---|
| F1-AC1 | A red atom block reaches the operator's console during a run | `engine --selftest` block | every red block printed, named, with its detail |
| F1-AC2 | Red atom blocks reach the JOURNAL's verdict line | `journal --selftest` + `engine --selftest` | names + details of RED blocks only, bounded |
| F1-AC3 | Green blocks are NOT journalled | same | 0 green blocks in the line — a journal of everything is a journal nobody reads |
| F1-AC4 | The bound cannot silently truncate | same | when blocks are dropped by the cap, the line SAYS how many |
| F1-AC5 | Every new guard proven able to fail | mutation run | ≥ 3 mutations, each reddening its own block, intact code reddening none |
| F1-AC6 | Zero GPU writes in this phase | burn log | **0** |

## Why this shape and not a bigger one

The obvious alternative — journal ALL atom blocks — is rejected on measurement, not taste: a rung
emits on the order of a dozen blocks, the sweep walks tens of rungs, and the journal is read **by
eye after an incident**. A line carrying every green block buries the one red one. The rule this
follows is the project's own: the pulse of a guarded loop is written only when work completes, and
for the same reason — a channel that speaks constantly stops being read.

**And the boundary matters for R15:** the verdict line grows, the INTENT line does not. The intent
is fsynced before the card is touched and must stay small and fixed; diagnosis belongs to the
verdict, exactly as `bugs/49` settled this morning.

## Steps

- [ ] **1. Inventory first, by the framework's own rule** — count what is lost today: how many
      blocks a rung emits, how many can be red, and which of them carry `undo`/`proof` kinds that
      already have their own channel. `grep -c "block(" automation-engine/lib/vf-step.mjs` plus a
      read of the three kinds. The fix is judged BY THIS LIST, not by one example.
- [ ] **2. `record.redBlocks`** — the rung collects the atom's failed blocks (name + detail), and
      `close()` writes them to the verdict. Bounded by a named constant in `config.mjs` (no magic
      numbers — safety-parameter rule), and the line states the count dropped.
- [ ] **3. The operator sees them** — `onEvent({kind: 'atom-red'})` per red block, printed by the
      CLI's existing `console.log(e.text)`. Named out loud rather than summarised: the operator is
      diagnosing, and the block's own wording is the evidence.
- [ ] **4. Do NOT duplicate the two channels that already exist.** `undo: true` blocks are already
      reported as «ОТКАТ НЕ ЧИСТ» and `proof: true` as «ПРОВЕРКА НЕ ДАЛА ОТВЕТА» (`plans/28`,
      finding A). Those two keep their own wording; this step covers the ORDINARY blocks, which
      today have no channel at all.
- [ ] **5. Blocks + mutations** (F1-AC5): a rung whose atom returns a red ordinary block →
      the verdict line carries it; a rung with only green blocks → the field is empty; the cap
      names what it dropped. Mutations: swallow the collection · journal green blocks too ·
      truncate silently.
- [ ] **6. Read the discriminator on the evidence we already have** — `runs/sweep/journal.jsonl`
      carries no atom blocks for `seq 700` (that is the defect), so phase 1 cannot retroactively
      answer `researches/18` §5. State that plainly in `bugs/50` rather than implying the next run
      is optional.
- [ ] **7. Judge pass** (`/fable-judge`) and close.

## Verification by observation

Each step's check is a command, not a reading:

- steps 2–5: `node automation-engine/engine.mjs --selftest` and
  `node automation-engine/lib/sweep-journal.mjs --selftest` — both must end with their summary line
  AND zero red blocks; the mutation runs must each end with «есть расхождения» naming ONE block.
- step 6: `node -e` over the production journal, printing the `redBlocks` field for `seq 700` —
  expected **absent**, which is the observation that closes the step honestly.
- F1-AC6: no command in this phase touches `nvapi`, `vf-step --set`, or the sweep without
  `--dry-run`.

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The verdict line grows without bound and the journal becomes unreadable | (a) | The cap is a named constant and the line reports what it dropped (F1-AC4) — silent truncation reads as «nothing else happened» |
| A red ordinary block is reported twice, once here and once as undo/proof | (b) | Step 4 excludes those two kinds by FIELD, not by name — a name match would be a truth↔mirror pair against block wording |
| The new field breaks a journal reader | (b) | Additive, `?? null`; the whole battery re-run is the check, as it was for `bugs/49`'s three fields this morning |
| Printing every red block floods a run with a systematic failure | (c) | Same cap applies to the event stream; the count is stated |
