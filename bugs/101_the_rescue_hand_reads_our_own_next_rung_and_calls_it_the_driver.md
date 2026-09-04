# Bug 101 — the rescue hand reads OUR OWN next rung's offset and calls it «the driver rewrites our writes»; the band then burns five rungs with the fuse gone

**Status:** 🔴 OPEN — analysis complete, nothing fixed (offline session; the owner's word 04.09 11:0x: *«после перезагрузки до понедельника работает только на виртуалке, без прогонов на реальной видеокарте»*) · **Filed:** 2026-09-04 12:0x (session 81) · **Found:** by reading three journals of the full pass 04.09 10:50 — `runs/sweep/journal.jsonl`, `runs/death-watch/2026-09-04T07-50-16-246Z-fuse.jsonl`, the Windows `System` log — against `runs/sweep-session80-polnyj-prohod.log` · **Severity: HIGH** — two of the three findings are engine defects on the live path; the third is a guard proved on the double and never mounted on the rocket (gate 6a).

⚠️ **ZERO GPU WRITES in this session.** The card is at factory after the owner's reboot (`runs/shell/boot-apply.jsonl` 11:13:14: `factory-by-physics`, power limit 300 W, remembered `factory`).

---

## Symptom (what the owner saw, and what the machine recorded)

The full pass `--sweep --from 2887 --to 900 --max-depth 245 --dashboard` started 10:50:09. At ~11:0x the owner reported a broken mouse cursor and a broken desktop wallpaper, and restarted the machine himself at 11:11:53 (`User32` 1074 — a clean restart, **no** `Kernel-Power` 41, no BSOD). The run had already ended ON ITS OWN at 10:57:44 with `ОСТАНОВЛЕНО (fuse-rescue): … АПВ НЕУСПЕШНО`, 447.9 s after start, 6 of 266 frequencies closed.

## Timeline — three journals, one clock (+03:00)

| time | journal | what |
|---|---|---|
| 10:50:33 | sweep seq 844 | 2835 MHz ← 890 mV; `furnace` exits code 1 |
| 10:50:38.7 | fuse trip **#1** | beat-silence 60.9 ms → kill-burn (furnace killed) → stock verified → **rearm** |
| 10:50:39 | Windows | `nvlddmkm` **153** — first of the day, coincides with trip #1 |
| 10:50:42 → 10:53:26 | seq 845…854 | 2737 MHz descends 890 → 825 mV, ten PASS in a row (seq 845 carries `writeFailureClass: C3` — «offers 15 MHz above the cap», the `bugs/92` **case 1** form; harmless, PASS) |
| 10:53:26 | seq 855 intent | 2737 MHz ← 820 mV |
| **10:53:34 → 10:55:59** | Windows | **20 × `nvlddmkm` 153 at a 7 s cadence** (+ one id 14 at 10:54:18) — the whole time the kernel of seq 855 was hung |
| 10:56:11 | seq 855 verdict | `CRASH / unknown` — «нагрузка не завершилась за 60000 мс — зависшее ядро»; the rung lasted **165 s** |
| 10:56:01 → 10:56:21 | fuse trips **#2…#6** | five beat-silences of 61…64 ms within 20 s; hand 1 finds NO burn to kill in four of five; each rescue verifies stock and **rearms** (2.3…9.1 s each); the judge's own tick rate collapses from ~410 to **4 ticks/s** at 10:56:11 — the machine is stuttering, and the judge re-arms into it |
| 10:56:12 | seq 856 intent | 2700 MHz ← 895 mV (seed), written while trip #4 fires 60 ms after rearm #3 |
| 10:56:23 | seq 856 verdict | `ЗАВИС`, decided by the fuse; red block **C1** «table did not settle in 6 probes, 1 of 127 agree — want 345000, got 0» = hand 2 of trips #4…#6 zeroing the curve under the rung's write; `offeredAfterMhz` 3187 |
| 10:56:21.4 | fuse trip **#7** intent | 61.8 ms silence, 60 ms after rearm #6 |
| 10:56:22.4 | fuse hand 2 | `stock-voltage` written (pid 51020) |
| **10:56:23** | **seq 857 intent** | **2700 MHz ← 970 mV, `deltaMhz: 75`** — the engine starts the next rung |
| 10:56:26.5 | fuse hand 2 | `stock-voltage-verified` **ok=false**: «C3 — драйвер правит результат: 126 записей … `want 0, got 75000`» |
| 10:56:26.7 | fuse | **`rearm-refused`** → judge exits code 2 |
| 10:56:23 → 10:57:44 | seq 857…861 | **five rungs of 2700 MHz burn and PASS with no fuse on post** (970 → 890 mV) |
| 10:57:44 | sweep | 2692 MHz closed `edge-found` 895 mV; **then** «ПОЛОСА ОСТАНОВЛЕНА … ПЕРЕД 2685 МГц: АПВ НЕУСПЕШНО» |
| 11:11:53 | Windows | owner restarts the machine (`User32` 1074) |

## Finding 1 — the «C3 in the rescue hand» is OUR write, both times (refutes `bugs/92` case 2)

Hand 2 of a rescue writes stock, then RE-READS the curve and demands zero offsets. The refusal detail names what it found: **`got 75000`** on 126 points on 04.09 — and **`got 113000`** on 127 points on 31.08 (`runs/death-watch/2026-08-31T14-03-05-531Z-fuse.jsonl:29`). Those are not the driver's numbers; they are the engine's:

| case | hand 2 wrote stock | hand 2 verified (failed) | engine intent IN that window | its `deltaMhz` | what hand 2 «found» |
|---|---|---|---|---|---|
| 31.08 | 17:04:38.240 | 17:04:42.057 | seq **833** at 17:04:38, 2115 MHz ← 815 mV | **113** | 113000 µ-units on 127 points |
| 04.09 | 10:56:22.372 | 10:56:26.530 | seq **857** at 10:56:23, 2700 MHz ← 970 mV | **75** | 75000 on 126 points |

Both are exact matches. **The rescue hand's read-back raced the sweep's write of the next rung**, saw the rung's raise, and the verifier — which cannot tell «the driver rewrote my zeros» from «somebody else wrote after me» — labelled it C3 and refused to rearm. The «rare C3 became frequent» conclusion of `bugs/92` is therefore **half refuted**: case 2 of that ticket and today's refusal are the same race, not the driver. Case 1 (the curve offering 15 MHz above the cap after a settled write — seq 702, 31.08 seq ~, today seq 845) is a different, still-open observation and stays with `bugs/92`.

Why the race exists (read in code, not guessed): the sweep asks «is the fuse on post?» by comparing `fuseMod.tripCount(lines) <= fuseMod.rearmCount(lines)` (`engine.mjs` ~11359, the `stopWhen` of `plans/81` Ш5). On a stuttering machine a new trip follows a rearm by **60 ms** (the deadman threshold itself), so the count says «on post» during the 60 ms between rearm #N and intent #N+1, the sweep proceeds to write, and trip #N+1's hand 2 runs its verification over the freshly written vector.

## Finding 2 — `stopWhen` is consulted once per FREQUENCY, so the band burned five rungs after the fuse left

`stopWhen` is evaluated at `engine.mjs:3841` (`const externalStop = stopWhen ? await stopWhen() : null;`) — in `sweepRange`, before each frequency, not before each rung. The judge exited with code 2 at 10:56:26.7; rungs seq 857…861 (10:56:23 → 10:57:44, 970 → 890 mV at 2700 MHz, each a 10 s furnace burn) ran with **no deadman armed**, and the stop arrived only «ПЕРЕД 2685 МГц». Phase 5 of epic 51 (`plans/58`) forbids a burn without an armed fuse; the sweep honoured the rule at the frequency boundary and not at the rung boundary. **P81-AC4 («ступеней после спасения без взведённого судьи») was violated by five on the live path** — the very criterion the count was built to serve.

This is the second half of why the owner's desktop was already broken while the run reported PASS after PASS: nothing was watching.

## Finding 3 — the fuse's input 2 (progress) is not wired on the sweep path; a hung kernel ran 165 s unseen

Seq 855 (2737 MHz / 820 mV) hung the GPU kernel: the furnace never returned, the driver complained 20 times at 7 s intervals, and the rung ended only by the burst timeout (`BURST_TIMEOUT_FLOOR_MS` 60 000) — 165 s from intent to verdict. The fuse saw nothing: throughout `runs/death-watch/…-fuse-alive.jsonl` **`worstProgressSilenceMs` is `null` on every line** (0 non-null of 167 lines in the window; 0 in the whole file), i.e. input 2 was never armed. `grep -n progress-file automation-engine/engine.mjs` → no match: the sweep does not pass `--progress-file` to the burn, and the fuse's `burnInFlight()` degrades to `true` when `progressFile === null`. R4c (`PROJECT_ARCHITECTURE_INTERNAL_MAP.md`) records input 2 as «проведено 2026-08-29, выигрыш 60 000 → ≈1000 мс» — proved on the double and by blocks; **on the live sweep it is not mounted** (gate 6a, the class the owner named 30.08: *«забыл поставить двигатель на ракету»*). The beat (input 1) stayed healthy during the hang (5…41 ms) because the OS was alive — only the GPU was not; that is exactly the failure input 2 exists for (R4c: «GPU не двигает работу, ОС жива»).

## Observation 4 — the judge re-arms into a machine that is still stuttering (named, not diagnosed)

Trips #2…#7 came 60 ms after each rearm; rearm's only criterion is «stock confirmed by reading». The judge's own tick rate was 4/s during that minute (vs ~410/s normal). Re-arming while the beat is still silent produces a trip storm (6 trips in 21 s) whose only effect is to zero the curve under whatever the sweep is doing — Finding 1's race is the direct consequence. Whether a rearm should also demand N healthy beats is a design fork (an agent-chosen number is what the owner rejected in `bugs/73`) — **recon before deciding (M4), not a patch.**

## What is NOT concluded

- Whether the `nvlddmkm` 153 storm (10:53:34…10:55:59) was CAUSED by the 820 mV rung or by the rescue storm: 153 has no registered text on this machine (`researches/30` §129). The 7 s cadence during a hung kernel is consistent with TDR-style recovery attempts, and that is a hypothesis, not a reading.
- Whether the display corruption (cursor, wallpaper) came from the kernel hang, from the driver resets, or from six curve zero/raise cycles in 21 s — the owner saw it at ~11:0x, after the run had ended.

## Fix plan — ORDER MATTERS, and none of it runs on the live card before Monday 08.09

1. **Finding 3 first** (mount input 2 on the sweep path): pass `--progress-file` from the sweep's burn to the fuse; prove on the double with `--rehearse-death progress-stall`, then a block in `engine --selftest` that reddens when the sweep spawns a furnace without the flag. Without it a hung kernel costs 60 s of a stuttering machine before anyone acts.
2. **Finding 2** (per-rung stop): call `stopWhen` before every rung, not every frequency; a block that runs a scripted sweep with a judge that «exits» mid-frequency and asserts the next rung never starts (P81-AC4 as a test, not a sentence).
3. **Finding 1** (the race): make the rescue hand and the rung's write mutually exclusive — the sweep must not write while a trip is in flight (`tripCount > rearmCount`, checked immediately before the atom's write, not only at boundaries), and hand 2's verifier must distinguish «a foreign write landed after mine» (the offsets match the journal's open intent) from «the driver rewrote me» — the first is a race to report, the second is C3. Then re-count `bugs/92` B92-AC1 with the race cases excluded.
4. Observation 4 → `researches/` recon (how deadman watchdogs decide re-arm: hysteresis, N healthy heartbeats) before any number enters `fuse.mjs`.

## Decisions made without the owner

- I did **not** touch the card, the fuse, the engine, or the journal; the run's harvest (`curves/measured.json`: 2692 → 895 mV edge-found; 2730 ← 835 · 2685 ← 935 harvest rows; ratchet 2842/2865/2880/2887 → 910 mV) is committed AS THE ENGINE WROTE IT — every row there came from a PASS with the oracle, including the five rungs of Finding 2. Whether rows proven with no fuse armed count as proof is the owner's call; I flag them here rather than delete measured facts: seq 857…861 fed row **2692 MHz (895 mV)** and harvest **2685 MHz (935 mV)**.
- `bugs/92` is not closed: only its case 2 is reassigned to this race; case 1 stands.

## Links

`bugs/92` (case 2 refuted here) · `bugs/50` (C3 case 1 origin) · `bugs/91` (the 31.08 kill-burn 6693 ms — same rescue storm) · `plans/81` Ш5 (the АПВ wait) · `plans/58` (phase 5: no burn without a fuse) · `plans/66` (input 2) · `researches/30` (`nvlddmkm` archive) · `runs/sweep-session80-polnyj-prohod.log` · `runs/logs/polnyj-prohod/2026-09-04T10-50-09+03-00.log` · `runs/death-watch/2026-09-04T07-50-16-246Z-fuse*.jsonl` · EXP-0233
