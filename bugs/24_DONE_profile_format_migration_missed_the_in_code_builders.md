# Bug 24 — the `curveCapMhz` format migration missed every profile BUILT IN CODE: three selftest suites are red, and the sweep's PIN path refuses below the cap floor

**Status:** ✅ DONE — fixed 2026-08-21, three suites green, mutation-proved in both directions
**Version/build:** `main` @ `3d0a9ac` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-21 00:2x +03:00, audit re-run of the full offline selftest battery.
No card involved — every observation below is offline.

## Symptom

Three suites the project's STATUS lists as green are red on disk, and have been since the
migration commit `2d7d266` (2026-08-16 22:13):

| suite | claim in STATUS | measured 2026-08-21 |
|---|---|---|
| `npm run descend -- --selftest` | 39 blocks green | **7 blocks red** («САМОПРОВЕРКА: есть расхождения») |
| `npm run profile -- --selftest` | 40 (now 46) green | **1 block red** |
| `npm run vgpu -- --selftest` | 63 (now 71) green | **1 block red** |

Every red block carries the same refusal:

```
settings.curveCapMhz: настройка не указана; null означает «заводское значение карты»,
пропуск не означает ничего
```

## Root cause — MEASURED, not reasoned

Session 30 made `settings.curveCapMhz` a **required-presence** key of the profile format
(`profile-store.mjs:47` `SETTING_KEYS`, refusal at `profile-store.mjs:463–487`) and migrated
**profiles-as-files and some fixtures** by script («все профили и фикстуры получили
`curveCapMhz: null` — переписано скриптом», STATUS session 30). The script rewrote JSON on disk.
**Profiles constructed by JavaScript code were not files, so the script never saw them.** Three
builders still emit the pre-migration shape:

1. **`ladder-descent.mjs:97` `candidateProfile()`** — emits `powerLimitWatts`,
   `graphicsClockLockMhz`, `curveRaiseAndCapMhz`, `curveRef` and **no `curveCapMhz`**
   (lines 106–117). The comment at line 113 even states the rule that convicts it: «the format
   treats an OMITTED setting as ambiguous».
2. **`profile-manager.mjs` selftest** — builds its measurement-pin fixture via
   `ld.candidateProfile(2130, …)` (`profile-manager.mjs:1239`), so the block
   «ПРИБОРНЫЙ пин (kind: measurement) ПРОХОДИТ гейт» — the very block that guards `bugs/05`
   against regression — now fails, i.e. **the bugs/05 regression guard is red while the defect
   it guards against is effectively back** (a measurement pin can NOT be applied).
3. **`virtual-gpu.mjs:1531`** — the `virtual-pl250` fixture profile, red block
   «ПРИМЕНИТЕЛЬ: apply работает на виртуальной карте без единой правки».

## Blast radius — the part that matters is NOT the selftests

`candidateProfile()` is **production code on the live path**:

- **`vf-step.mjs:756`** (inside `runStep`, the pin branch):
  `pm.apply(pmBackend, ld.candidateProfile(pinMhz, card), …)`. `apply()` validates before
  writing, so **every rung whose ceiling must be held by a clock pin refuses at apply time**.
  The cap floor is ~2157 MHz (fact 38): the ENTIRE LOWER HALF of the range — exactly the part
  of the owner's standing release-candidate order `--sweep --from 2887 --to 900` that no live
  run has reached yet — hits this branch. The 2026-08-16 live runs never saw it because they
  worked at 2842–2820 MHz, above the floor, where the curve holds the ceiling and no pin is
  applied. **This is a latent full-range-sweep blocker, invisible until the sweep first
  descends past ~2157 MHz.**
- **`npm run descend`** (phase-2 ladder, `ladder-descent.mjs:200`) and **`vf-step.mjs:1194`** —
  same refusal on their first candidate.

Direction of failure is safe (refusal before any GPU write — nothing is written wrongly), but
the refusal presents as a mid-run halt on the owner's time, at the worst moment: mid-sweep,
hours in.

## Why no one saw it for five days

There is **no aggregate gate that runs the whole selftest battery**. `npm run check` proves
parse + encoding only; each suite is run by hand when its module is touched. The battery was
last re-run whole on 2026-08-16 00:2x («перемерены») — BEFORE the migration landed at 22:13
the same day. Sessions 31–32 re-ran only `engine`, `journal`, `curve`, `traps`, `contract`.
So STATUS carried three stale-green claims for five days — the exact false-`[TESTED]` class
`TESTING_FRAMEWORK.md` exists to kill, this time at the level of the claims table rather than
a single marker. Separate follow-up: an `npm run selftest:all` (or equivalent) so «перемерено»
is one command, not thirteen memories.

## Fix plan

1. Add `curveCapMhz: null` to `candidateProfile()` (`ladder-descent.mjs:106–117`) with the same
   spelled-out-instead-of-omitted comment the neighbouring keys carry, and to `virtual-pl250`
   (`virtual-gpu.mjs:1531`).
2. Re-run the three red suites → expect 0 red.
3. Red-proof per EXP-0008: temporarily removing the key again must redden exactly the blocks
   listed above (the mutation already exists in history — commit `2d7d266`'s requirement).
4. Prove the pin path end-to-end offline: `npm run bench` (or the trap suite) over a band below
   the cap floor, where `chooseWriteShape` demands `pinMhz` — the rehearsal stand's step
   function must apply a pinned candidate successfully.
5. File the aggregate-battery gate as its own backlog item (named in the audit report).

## Verification by observation

- `npm run descend -- --selftest` · `npm run profile -- --selftest` · `npm run vgpu -- --selftest`
  → all green, counts reported.
- Dry run below the floor names the pin as holder and the plan validates.

## Lesson candidate (for EXPERIENCE.md on close)

A format migration executed «by script over files» is only complete when the FORMAT'S CONSUMERS
are enumerated — a profile is built in three places that are not files. The enumeration was
available the whole time: `grep candidateProfile`, one command. Same family as EXP-0089
(a rule keyed to the wrong axis silently misses part of the space), applied to migrations.

---

## ✅ STATUS: DONE (2026-08-21 00:4x +03:00)

**Two addresses, one key each.** `curveCapMhz: null` added to `ladder-descent.candidateProfile()`
and to the `virtual-pl250` fixture in `virtual-gpu.mjs`, each with the comment the neighbouring keys
carry — the format treats an OMITTED setting as ambiguous, so the key is spelled out rather than left
to be inferred. The third address named in this document (`profile-manager.mjs:1239`) needed no edit:
it builds its fixture through `candidateProfile`, so fixing the builder fixed it.

**The enumeration was completed rather than assumed** — the lesson below is exactly about a migration
that stopped short of its consumers, so the fix does not get to stop short either.
`grep -rn "powerLimitWatts" --include=*.mjs --include=*.ps1 --include=*.json .` finds **every** place
a profile's `settings` object is built: four modules touch the format, exactly two built it wrong,
and all seven profiles on disk already carried the key. There is no third builder.

### Measured before and after, same commands

| suite | before (reproduced 2026-08-21 00:2x) | after |
|---|---|---|
| `npm run descend -- --selftest` | 🔴 7 blocks red | ✅ **39 blocks, all agree** |
| `npm run profile -- --selftest` | 🔴 46 blocks, 1 failed | ✅ **46 blocks, 0 failed** |
| `npm run vgpu -- --selftest` | 🔴 71 blocks, 1 failed | ✅ **71 blocks, 0 failed** |

The red block in `profile` was, as this document predicted, the `bugs/05` regression guard:
«ПРИБОРНЫЙ пин (kind: measurement) ПРОХОДИТ гейт и реально пишется (bugs/05)».

### Red-proved per EXP-0008, and each mutation reddened ONLY its own blocks

- **Mutation 1** — delete `curveCapMhz` from `candidateProfile()` again → `descend` 7 red +
  `profile` 1 red (named: the `bugs/05` guard), and **`vgpu` stayed green**.
- **Mutation 2** — delete it from `virtual-pl250` again → `vgpu` 1 red (named: «ПРИМЕНИТЕЛЬ: apply
  работает на виртуальной карте без единой правки»), and **`descend` and `profile` stayed green**.

That separation is the point: it proves the three suites were red for TWO independent reasons and
that each fix is load-bearing for its own blocks (EXP-0071 — a block that a neighbouring change also
turns green does not test your change). Working tree restored from a byte copy after each mutation;
`git diff --stat` showed only the two intended edits.

### The pin path, proved offline end to end

`profile --selftest` block «ПРИБОРНЫЙ пин … ПРОХОДИТ гейт и **реально пишется**» drives
`candidateProfile(2130, card)` through the real `apply()` — the qualification gate, the format
validator, and then `b.writes.length` asserted non-empty, so a gate that passed while writing nothing
would still be red. That is the production pin path (`vf-step.mjs:756`) exercised without a card.

Independently confirmed, offline, that the pin branch is the one the lower half of the band takes —
`chooseWriteShape` asked directly on the bench card's own V/F table, shipped defaults:

| clock | `capEnforced` | verdict |
|---|---|---|
| 2842 МГц | true | holder = **кривая**, `pinRequired: false` |
| 2200 МГц | true | holder = **кривая**, `pinRequired: false` |
| **2100 МГц** | false | holder = **закрепление частоты**, `pinRequired: true`, shape `uniform` |
| **1800 МГц** | false | holder = **закрепление частоты**, `pinRequired: true`, shape `uniform` |

(The floor is 2185 MHz on the bench card's geometry, ~2157 MHz on the owner's — fact 38. The number
differs, the conclusion does not.) So the blast radius stated above is confirmed by measurement and
not only by reading: **below the floor the sweep requires the pin, and the pin was unapplicable.**

### Step 4 of the fix plan could NOT be executed as written — and that is a separate defect

The plan asked for `npm run bench` over a band below the cap floor as the end-to-end rehearsal.
It does not rehearse this path: `trap-suite.makeSweepStepFn` ignores the `writeShape`/`pinMhz`
decision it is handed and always writes a capped raise at the clock under test, so `npm run bench --
--from 2100 --to 2100` halts on the virtual card's own R11 refusal («потолок 2100 МГц кривой не
удержать: пол 2185 МГц») for a reason the live path never meets, and `candidateProfile` is never
called on the bench at all. Filed as **`bugs/26`** with the measurements. It does not block this
close — the pin path has an offline proof, named above — but it does mean **the rehearsal stand
currently cannot rehearse the lower half of the owner's standing order.**

### The follow-up this bug named is DONE in the same session

`npm run selftest:all` (`tools/selftest-all.mjs`) — the whole offline battery, 17 suites, one
command, 848 green blocks, 10.9 s. It judges each suite by THREE readings at once (exit code · red
lines counted in all four vocabularies the battery speaks · the completion line demanded present) and
calls a disagreement between them red. **Red-proved against this very defect:** with mutation 1 in
place the battery reddens on exactly `descend` and `profile`, names both, quotes their summary lines
and exits 1. Numbers in `STATUS.md` now come only from its output.

### Acceptance criteria — observed, not claimed

- ✅ three suites green, counts reported: 39 · 46 · 71
- ✅ `npm run check` green after the edits: 45 files parsed, 268 texts scanned, 0 encoding corruption
- ✅ the whole battery green: `npm run selftest:all` → 17 suites, 0 red
- ✅ mutation-proved in both directions, each mutation reddening only its own blocks
- ⚠️ «dry run below the floor names the pin as holder» — proved on the bench card's table by asking
  `chooseWriteShape` directly (table above), NOT by `npm run engine -- --band --dry-run`, which
  probes the live card. The live-card dry run stays for the session that has the card free.
