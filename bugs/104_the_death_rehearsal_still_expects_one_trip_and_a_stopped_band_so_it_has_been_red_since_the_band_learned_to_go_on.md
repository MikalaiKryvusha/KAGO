# Bug 104 — the twin's death rehearsal still asserts ONE trip and a STOPPED band, so it has been red since 31.08 — and a filtered grep let a session report it as 7/7

**Status:** 🔴 OPEN — found by the closing judge pass of session 82 · **Filed:** 2026-09-04 16:0x (session 82, offline) · **Found:** `node automation-engine/lib/twin-assembly.mjs --rehearse-death progress-stall --no-window` run twice (15:18 and 16:01) — exit code **1** both times, two `🔴` checks each · **Severity: medium** — the rehearsal is the instrument that certifies the fuse's rescue chain end-to-end on the double (P63-AC5, P66-AC5); an instrument red for five days that nobody ran certifies nothing, and a reader who filters its output can report it green.

⚠️ **ZERO GPU WRITES.** Everything here runs on the double; I1 (live artefacts untouched) was ✅ in both runs.

---

## Symptom

`--rehearse-death progress-stall`, two runs on the same tree, both exit 1:

| check (`twin-assembly.mjs` ~573–583) | 15:18 | 16:01 | what the sandbox actually holds |
|---|---|---|---|
| «трип случился (намерение в журнале судьи, причина progress-stall)» = `intents.length === 1 && cause === 'progress-stall'` | 🔴 | 🔴 | **3 intents, every one `progress-stall`** (`benches/runs/twin-2026-09-04T15-18-19-03-00/fuse.jsonl`, `…T16-01-17…`) |
| «полоса ВСТАЛА до следующей ступени (stopWhen: судья вышел, код 2 — спасение)» = `/СПАСЕНИЕ сработало/.test(log)` | 🔴 | 🔴 | the log says «⚡ СПАСЕНИЕ на 2842 МГц … **ПОЛОСА ПРОДОЛЖАЕТСЯ**», then 2835, then 2820 — the band went on, as the owner ordered |
| hand 1 · hand 2 (stock verified by reading) · the rung failed by the oracle's road · ring dumped · pulse in the sandbox · I1 | ✅ ×6 | ✅ ×6 | rearms `true,true,true` (15:18) · `true,true` (16:01) |

So the rescue chain of input 2 WORKS on the double — three times per run — and the two red checks describe the engine as it was before 31.08.

## Forensics — read, not guessed

- The two assertions were written **2026-08-29** (`c2b2594`, epic 59 phase 4: «смерти по профилям — фьюз спасает») when a trip ended the band: one trip, the band stopped, the log said «СПАСЕНИЕ сработало».
- **2026-08-31** (`29358f4`, `bugs/90` + `plans/82` Ш3: «спасения больше не останавливают полосу», the owner's word in `interviews/024` = E) changed the engine: after a rescue the band waits for АПВ and continues, printing «ПОЛОСА ПРОДОЛЖАЕТСЯ». The rehearsal's checks were not touched. With the stall profile («прогресс встал» from the first second of every burn) every frequency of the band now stalls, so the run has as many trips as frequencies it reaches — three here.
- The rehearsal is NOT in the battery (`selftest-all.mjs` runs `twin --selftest`, not the rehearsal), so nothing re-ran it between 31.08 and today. `plans/66` AC5 (29.08) and `plans/63` still cite it as green — true on their dates.
- **The second half, mine (session 82):** the first run's output went through `grep "progress-stall|ТРИП|трип|СПАСЕН|✅|❌|…"`. The line «🔴 полоса ВСТАЛА до следующей ступени (… спасение)» matched none of it (lower-case «спасение», a `🔴` that is not `❌`), the other 🔴 line survived only because it contains «трип», and I read seven lines with one 🔴 as «7/7» and wrote that into `bugs/101`, `STATUS.md` and EXP-0235. In this rehearsal `🔴` is a FAILED check (`okc ? '✅' : '🔴'`, `bad += 1`, exit 1) — not a colour. EXP-0234's second half, paid the day before, verbatim: a filtered pipe became the instrument's «defect». Caught by the judge pass at closure, corrected in all three places.

## What is NOT concluded

- Whether 16:01's third rescue simply ran out of band before its rearm line (14 journal lines vs 15) or something else — the run reached its last frequency; not investigated, noted.
- Whether `strangle` and `instant` profiles carry the same stale checks (the same `checks` array feeds all three profiles; `intents.length === 1` may still hold for them because their probes stop beating for good). Run them before rewriting.

## Fix plan

1. Rewrite the two checks to Ш5 semantics, keeping the strict part: **every** intent's cause equals the profile's (`progress-stall` for the stall profile, `beat-silence` otherwise) and there is **at least one**; the band **continued** — count «ПОЛОСА ПРОДОЛЖАЕТСЯ» lines ≥ 1 and assert the run reached a frequency after the first rescue (the journal's seq after the first intent). Then a mutation each: fake a `beat-silence` intent into the fixture → check 1 red; strip «ПОЛОСА ПРОДОЛЖАЕТСЯ» → check 2 red.
2. Run all three profiles; write their exit codes here.
3. Put the rehearsal where a stale check cannot hide for five days: either into the battery behind a duration budget, or into the closing ceremony's pair registry as «rehearsal exit 0» — decided by its wall time (≈ 12 s per profile today).
4. The reader's half: never judge a rehearsal by a filtered grep — by its exit code and the count of `🔴` lines (EXP-0237).

## Acceptance

| # | criterion | scale · meter · target |
|---|---|---|
| B104-AC1 | the rehearsal is green on the current engine without weakening the cause check | `--rehearse-death progress-stall` exit 0; the cause assertion still covers every intent; mutation «beat-silence intent» reddens it |
| B104-AC2 | the band-continues behaviour is ASSERTED, not tolerated | a check that reddens when «ПОЛОСА ПРОДОЛЖАЕТСЯ» is absent |
| B104-AC3 | all three profiles run and their codes are in this ticket | `strangle` · `instant` · `progress-stall` |

## Decisions made without the owner

None. Nothing in the engine or the rehearsal was changed; the false «7/7» was corrected in the three documents that carried it.

## Links

`automation-engine/lib/twin-assembly.mjs` → `mainRehearseDeath` (checks ~573–583) · `plans/63` (the rehearsal) · `plans/66` AC5 · `plans/81` Ш5 · `bugs/90` (the band goes on) · `interviews/024` = E · `bugs/101` (the session whose closure found this) · EXP-0234 · EXP-0237
