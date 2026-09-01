# GPU_TUNING_RAILS — the rails a weak executor session rides

> **What this is.** The ONE routing document for operating KAGO's bench and search machinery
> (`ideas/01`, the owner's word: rails «которыми даже слабая модель типа Opus может потом
> пользоваться, для тюнинга GPU и поиска края»). It does not teach the method — it routes you to
> the paid-for answer: *want X → run Y, expect Z; verdict V → do W; Z is forbidden, and here is
> the STOP line.* Sources of truth stay where they live (`researches/`, `bugs/`, `EXPERIENCE.md`,
> the code's own guards); this file only points. **v1** — command rails over the existing bench.
> v2 (after phase 5) becomes a `/fable-domain` skill bundle for the edge search proper.
>
> **Audience:** the agent (any strength). English by the language rule. The owner reads the digest
> in `STATUS.md`.
>
> **How to use it as a weak session:** read `STATUS.md` + this file. If the operation you want has
> no rail here — that IS a stop: report, do not invent (I1-AC2: every rule below carries either a
> MACHINE gate that physically refuses, or a STOP line you obey yourself).

---

## 0. The three iron invariants (each one bought with an incident)

| # | Invariant | Gate |
|---|---|---|
| S1 | **Live writes to the V/F curve or a sweep happen ONLY with the owner at the machine.** The machine hung 5 h 40 min on an unattended sweep; three of four rollback layers need a live OS (`bugs/03`, R10). | **STOP line** — no machine gate can enforce presence. Before any `engine --band` / `vfstep --set` live run: the owner has said, in this chat, that he is at the machine. No quote → do not run. |
| S2 | **The first step is the shallowest step.** At depth, step size is the ONLY protection (R10). **The depth is measured from what EVIDENCE has proven, not from stock** — with no evidence the two are the same, so the rail did not move, it grew a clause. | **MACHINE** — `engine.pickAscentRungs()` refuses a first step > 25 mV past PROVEN ground (`provenSavedMv`, 0 = stock = no evidence) or a rung gap > 35 mV, BEFORE the first write; `engine.sweepFrequency` applies the same cliff to the step from a SEED down to the ladder. Both mutation-proved, and the no-evidence case is asserted BYTE-identical to the pre-seeding behaviour (F2-AC2, mutation 28). Your duty: run `--dry-run` first and READ the printed first-step depth — the sweep's dry run prints it per frequency, computed by the SAME function the run walks (F2-AC8), so it cannot advertise a ladder the run will not take (`bugs/09`). |
| S3 | **Every write runs under an armed watchdog, and rollback is a list, not a chain** (R9, R10a). | **MACHINE** — `vfstep`/`engine`/`fanladder`/`thermal` arm it themselves; the detached guard restores the card on writer death (drilled: 2.5 s). Your duty: never write through any path that is not one of the rails in §2 — a direct `nvapi` write bypasses the whole net. **STOP line:** if `watchdog -- --status` says a record is held at rest, run `--recover` before anything else. |

Above all three sits **THE OWNER'S-MACHINE RULE** (`AGENT_GUIDE.md`): look the flag up first ·
name the rollback BEFORE the write · smallest reversible form · re-read state until stable ·
report numbers. A permission entry in settings is not a reason to act.

### S4 — A HANG IS A DEFECT OF OURS, NOT A NORMAL PATH (owner's word, 2026-08-30 evening)

> *«отныне зависание машины при тюнинге и поиске края мы не считаем нормальным событием. Оно
> возможно, оно допустимо, но мы считаем это плохим нежелательным событием — нашим провалом в
> разработке предохранителя и оракула»* (`GOAL.md` → «🔴 ЗАВИСАНИЕ — НЕ НОРМАЛЬНОЕ СОБЫТИЕ»).

This does NOT change what the machinery may do: a hang is still survivable, `ЗАВИС` is still a
first-class verdict, the sweep still resumes by itself, and the run does not stop being allowed.
It changes what a session may CONCLUDE about one. The 2026-08-15 framing — a hang is «the normal
path of a verdict» — is history with a date; the standing framing is: the path is passable and
BAD.

| Your duty when a run hangs | Not enough |
|---|---|
| File the defect: WHY did the fuse not save, and WHY did the oracle not warn (both are our code) | A `ЗАВИС` line in the journal with the frequency it closed |
| Count hangs per evening as a quality number of the fuse + oracle, expected to FALL | «Reached the end of the band, through a hang» reported as success |
| Never write «штатный / нормальный / ожидаемый» next to a hang in any report, plan or summary | Calling it as-designed because the verdict path handled it |

**STOP line, and it is narrow:** this is not a reason to make the fuse stricter at the price of
refusals — the owner's other standing word governs that («🏗 ЗДАНИЕ ВАЖНЕЕ ЛЕСОВ»: *«сторож должен
не ронять инструмент, а подсказывать»*). S4 changes the VERDICT ON THE EVENT, never the run's
right to continue.

## 1. Session start — always, in this order

```
npm install                    # koffi dependency
npm run check                  # expect: 74 .mjs files, 0 failed (re-measured 2026-09-01 08:5x)
npm run selftest:all           # expect: 45 sets, 0 red, 2403 green blocks (re-measured 2026-09-01 09:06)
npm run traps                  # expect: 65 assertions, 0 failures, 0 WAITING (re-measured 2026-08-31 14:0x)
npm run gpu:info               # expect: driver 610.88, VBIOS 98.03.58.40.8b, 250–300 W, 3090 MHz
npm run watchdog -- --status   # expect: «СТОРОЖ НЕ ВЗВЕДЁН»
npm run questions              # expect: «ЧИСТО»
```

> ⚠️ **The counts above are re-measured by the commands themselves, never edited by hand** — the same
> rule `STATUS.md` states for its own battery line. This block carried «33 .mjs files» for eleven
> days after the tree had grown to 56, which is how a session learns to skip a number it is supposed
> to compare against.
>
> 🔴 **AND IT HAPPENED A SECOND TIME — recorded rather than quietly corrected (2026-08-31).** The
> block stood at «56 .mjs · 28 sets · 1394 blocks» for six days while the tree ran 74 · 45 · 2293:
> the battery had grown by SEVENTEEN sets and the expectation never moved. A session obeying this
> file literally would have read «28 sets» against a run printing 45 and had to decide, alone, which
> number was the defect. **The lesson is about the CARRIER, not about diligence:** a number that a
> command prints and a document repeats is a truth↔mirror pair, and this one has now drifted twice
> for the same reason — nothing runs the comparison. Until a gate prints the diff, the honest form is
> the one used here: every count carries the DATE it was measured, so a reader can see at a glance
> how old the expectation is instead of trusting it.

**STOP lines:** driver ≠ 610.88 → every golden, checksum and NVAPI id is invalid until re-proved
(R6); report, do not proceed. Fresh clone → `runs/` is empty, every stress verdict is UNKNOWN
until `npm run stress -- --capture-baseline` (which needs a stock card). Background GPU load
(Chrome, Docker, overlays — idle clock ~825 MHz instead of ~180) → measurements are invalid;
stopping owner apps is allowed by his word, restore them after (`STATUS.md` → машина).

## 2. Command rails — want X → run Y

**Read-only (safe at any moment):**

| Want | Run | Expect |
|---|---|---|
| card telemetry, one probe | `npm run mon -- --once` | all config fields populated |
| the V/F curve, fans, ids | `npm run nvapi` · `-- --curve` · `-- --fans` | 17/17 ids · 128 points · floor 30 % |
| driver/offset ranges | `npm run nvml` | read-only; NVML is an instrument, never a backend |
| what the ratchet knows | `npm run vmin -- --show` | per-point verdicts; ratchet never lowers |
| profiles on disk vs live card | `npm run profiles` | 6 profiles, 0 refusals; drafts labeled 📝 |
| shell health (tasks, tray) | `npm run setup -- --status` | 7/7 tasks, tray alive |
| boot-series meter (P3-AC2) | read `runs/shell/boot-apply.jsonl` | one JSON line per logon; series closes at 5 natural verified records |
| re-analyze recorded telemetry | `npm run thermal -- --analyze` | plateau verdict per run, no card touched |
| WHERE inside a rung the card idles | `npm run pulse -- --rung-profile` | second-by-second load/idle profile of a rung, averaged over the run, plus the gap BETWEEN rungs. Measured 2026-08-26: the between-rung gap is **0.0 s** — all idle lives INSIDE the rung, as head (write + arm) and tail (rollback + disarm). Reads two files, writes nothing (`bugs/53`) |
| what a run BOUGHT vs what it WASTED | the sweep's own summary: `УРОЖАЙ:` then `ПРОЖИГОВ БЕЗ НОВОЙ ГЛУБИНЫ: N из M` | printed on every run and every `bench` rehearsal, **0 printed honestly**. ⚠️ Read the number BESIDE it: on a band where no delivered frequency was burned twice, «0 wasted» means «there was nowhere to waste», not «the engine does not waste». Same counter re-measures any PAST run from `runs/sweep/journal.jsonl` with no new burn (`harvestFromJournal`) |

**Loads & verdicts (load the card, write nothing):**

| Want | Run | Expect |
|---|---|---|
| stability verdict, one shape | `npm run stress -- --workload sdc_fma --sustain 30` | PASS / SDC / CRASH / UNKNOWN |
| the shape that exposes bad profiles | `... --transient` | transitions, not steady load (`researches/02`) |
| goldens still valid | `npm run stress -- --verify-baseline` | every stamp matches the card |
| FPS bench gate (FIRST, always) | `npm run gfx -- --prove-not-capped` | FPS moves ≥ 5 % (took +46 %); a number that ignores its input is capped, not precise |
| game run with telemetry | `npm run gfx -- --capture --label <l>` | `faultFree`, never PASS (no checksum half) |
| instrument floor between runs | `npm run gfx -- --spread <prefix>` | floor 0.90 % on this card; a delta below the floor is NOISE, not an effect |

**Writes (owner-gated by S1 where marked; all under the watchdog):**

| Want | Run | Gate |
|---|---|---|
| plan a curve step, no write | `npm run vfstep -- --set ... --dry-run` · `npm run engine -- --band N --dry-run` | free; READ the first-step depth line |
| one candidate, judged by the 3-shape set | `npm run vfstep -- --set --point N --mhz M --cap C` | **S1 — owner present** |
| the SHIPPED shape by hand (whole curve + ceiling) | `npm run vfstep -- --shipped-shape --mhz M --cap C` | **S1 — owner present.** Refuses without `--cap`: no ceiling, no shipped shape |
| edge search at one clock | `npm run engine -- --search --cap C` | **S1 — owner present.** Writes the SHIPPED shape and walks the VOLTAGE ladder. **REFUSES outright when `C` is below the curve's floor** (`top − 1000 MHz`, = 2157 on this card): with no pin, nothing would hold the ceiling |
| edge search on one frequency band | `npm run engine -- --band N --seconds 10` | **S1 — owner present.** Per rung it prints WHICH shape it writes and WHO holds the ceiling — above the floor «кривая + замок» (curve + BOUND), below it the clock PIN. `bugs/02` step 1 landed 2026-08-14; the search no longer halts by design |
| **sweep a band top-down** | `npm run engine -- --sweep --from N --to N --max-depth D --log <meaning> [--dashboard]` | **S1 — owner present.** ALWAYS run `--dry-run` first and read it (S2): it prints, per frequency, the first-step depth AND the holder. Resumes an interrupted sweep from the write-ahead journal by itself |
| **rehearse the same sweep offline** | `npm run bench -- --from N --to N [--max-depth D]` | free — virtual card, no GPU write at all. Carries the SAME limits as the live run, so it rehearses the same work |
| apply / reset a profile | `npm run profile -- --apply <id>` · `-- --reset` | drafts REFUSE until phase 6 (machine gate); reset is always legal |
| fan level (upward only) | `npm run nvapi -- --fan-write 80 [--cool-to 42]` | state change → owner aware; AUTO restored in `finally` |
| acoustic / thermal ladders | `npm run fanladder -- --period 15` · `npm run thermal -- --points ...` | owner present (fanladder needs his EAR) |

> 🔴 **NEVER PIPE A RUN INTO `tee` — USE `--log` (`bugs/93`, paid for on 2026-08-31).** The shell hands
> the caller the exit code of the LAST command in a pipe, so `npm run engine … | tee x.log` reports
> `tee`'s success. Both live runs that evening returned **0** while the second had been halted by a
> rescue — erasing the very discriminator `bugs/67` spent three weeks building. `--log` writes the run's
> own journal, so the file exists without a pipe and the exit code reaches the caller. The log's LAST
> LINE is `КОД ВОЗВРАТА: N`, so the file alone answers «did the evening succeed?» — an autonomous loop
> reads the code, a human reads the line.
>
> **The machine names the file, you name the MEANING — the owner's rule, 2026-08-31:** *«не надо
> называть vecher · есть дата и время на машине — так логи и называть, в одну директорию складывать,
> внутри можно делать поддиректории с названием смысла прогонов»*. So `--log <meaning>` lands at
> **`runs/logs/<meaning>/<machine date-time>.log`** — one directory for every run log, a subdirectory
> per meaning, the filename always the clock. Names invented by mood («vecher», «test2»,
> «final-final») stop answering «which run was this?» within a week; a stamp answers forever and sorts
> itself. Omit the meaning and it is taken from the MODE (`sweep` · `band` · `search` · `dry-run`) —
> never invented. Runs accumulate; nothing is ever overwritten (`bugs/94`).
>
> Applies to every mode of `npm run engine`, not just `--sweep`. If you catch yourself typing a pipe
> because you want the output on disk — that want is exactly what `--log` exists for.

## 3. Verdict dictionary — verdict V → do W

| Verdict | Meaning | Do |
|---|---|---|
| **PASS** | checksum matched golden AND no fault events AND throughput sane | proceed; one PASS never qualifies a point — qualification is phase 6's |
| **SDC** | silent data corruption — output wrong, no crash | the point failed; ratchet records it; NEVER retry hoping |
| **CRASH** | process/driver/TDR death in the window | as SDC, plus check `watchdog -- --status` recovered |
| **UNKNOWN / НЕИЗВЕСТНО** | comparison could not happen (stale stamp, no baseline, wrong args) | **STOP.** Never coerce into PASS/SDC; fix the reason first |
| boot-apply verdicts (8) | `applied · factory-by-physics · factory-restored · degraded-to-factory · no-remembered-state · remembered-unreadable · driver-gave-up · apply-failed-rolled-back` | all are TERMINAL journal states; anything else in the journal is a bug to file |

**Reading rules bought with measurements:** **a burn on a delivered frequency already proven DEEPER
in this same run buys nothing** — the owner's word 2026-08-25 *«ни один прожиг не должен быть в
пустую»*, and the «isn't a repeat a second sample of a probabilistic edge?» fork is closed by his
own answer `interviews/014` Q5 = B (*one burn proves it, move on*). Measured today: 2 of 11 live,
24 of 89 on the ordinary rehearsal · a point is judged by the WORST shape of the set, and
the deciding shape is named (fact 37) · price under a game is FPS; ops/s is a clock-stretching
detector, not a price (R4a, EXP-0030) · **a shortfall of the delivered clock is a MEASUREMENT, not a
refusal** — the row goes to the frequency the card actually ran (canon 2026-08-22); only going ABOVE
the ceiling is a failure · a delta below the instrument's measured floor is noise
(EXP-0032) · the edge is PROBABILISTIC — same voltage can PASS and CRASH (`researches/02` §6.4);
**the shipping margin is the LAST STABLE rung + ONE minimum grid step** (= 5 mV on this card) — the
owner's re-anchoring of 2026-08-17, *«последняя стабильная до отказа точка (соседка отказа сверху)
+ 5 мВ»*, and the anchor is the PASS, never the failure (`config.marginAboveLastStableMv`, which
REFUSES a doubled cushion by name) · convert the search
unit into the physical unit THROUGH AN OBSERVED READ-BACK, never through a model of the state
(EXP-0034, `bugs/02`) · fan/temperature pairs are valid only at a DETECTED plateau — transients
under-read fans by 10–18 pp (facts 35–36) · **a CEILING must be held by something and the run names
by what** — and since 2026-08-25 the answer above the floor is TWO holders, not one: **the curve from
below AND a clock BOUND from above** («кривая + замок»). The curve alone is NOT a ceiling — measured
9 rungs of 9, the card runs 2–3 grid steps above it while the write is provably intact
(`researches/11` §8, `bugs/50`, owner's decision `interviews/015` Q1 = A · Q2 = A). Below the floor
(`top − 1000 MHz`, 2157 here) nothing can be capped and the clock PIN holds it, and the shape is no
longer the shipped one (`bugs/02` step 1).

⚠️ **BOUND ≠ PIN, and confusing them re-runs a paid-for incident.** A BOUND is `-lgc <ladder floor,
ceiling>`: the card stays free DOWNWARD, and its proof is «never ABOVE». A PIN is `-lgc min=max`: it
ORDERS a frequency, its proof is «the clock is CONSTANT», and it is forbidden in anything shipped
(the owner's rule that the card must keep its dynamic range). Demanding constancy under a BOUND is
the 2026-08-14 conflict verbatim — three rungs whose every load shape PASSED were reported
НЕИЗВЕСТНО, and mutation NC reproduced it on the bench in 2026-08-25 (a healthy band closed 0 of 6).

## 4. Standing STOP lines (the full list)

1. **3 failed fix attempts → STOP → `/bug-research`** (`BUG_FIXING_FRAMEWORK.md`). Never a fourth
   blind poke.
2. **UNKNOWN verdict → STOP** (§3).
3. **No rail for the operation → STOP and report** — inventing method is the exact failure these
   rails exist to prevent (I1-AC1).
4. **Any owner-level fork (vision, UX, budget) → interview** (`npm run ask`), never a chat guess —
   but METHOD questions are yours, not his (EXP-0026).
5. **Anything that writes outside the repo** (registry, scheduler, installs) → the owner's-machine
   rule, five steps, rollback named first.
6. **A guard that fired and got explained away is a guard that did not fire** (EXP-0034 second
   strike) — a red block stops the run until understood.
7. **Windows CLIs with `/`-flags and PowerShell payloads run through PowerShell, never Git Bash**
   (EXP-0043) · **prose is edited with file tools, never through shell arguments** (EXP-0035).
8. 🆕 **A HOLE, A BUG OR ANY UNFORESEEN BEHAVIOUR FOUND MID-RUN → STOP THE RUN AND FIX IT.**
   The owner's word, 2026-08-31: *«пока мы делаем KAGO и находим дыры, баги, непредвиденное
   поведение - это для тебя повод остановить прогон и чинить. Мы стемимся к тому, что
   непредвиденного для нас не осталось, и багов и дыр в движке нет»*
   (`GOAL.md` → «🤖 KAGO ТЮНИТ САМ И ОТДАЁТ ПРОФИЛИ»).
   **There is nothing left to weigh.** The old trade — stop and lose the evening, or note it in the
   baton and keep the tempo — is settled: the finding IS the reason to stop. **«Unforeseen
   behaviour» ranks with «bug»**: it is enough that the system did something you did not expect;
   proving it is a defect is NOT a precondition for stopping.
   Why this is correct rather than merely cautious: a hole walked past for tempo stays in the
   product, and the next meeting with it is at the USER's machine — without us and without a log.
   That tempo is paid for with their crash.
   This generalises STOP line 6 from guards to ANY unforeseen observation, and it is a
   DEVELOPMENT-MODE rule (the owner's own boundary in the same message): the finished product has
   nothing to stop for, because by then the holes are gone — that is what «finished» means.

## 5. Maintenance

A new instrument, verdict or paid-for rule lands here the same session it is born (one row/line,
pointing at its source). This file is a ROUTER: if a section starts explaining instead of
pointing, it is drifting into a second canon — cut it back. v2 (the `/fable-domain` bundle with
flowchart, trap and smoke eval) is gated on phase 5 closing the search's true form.
