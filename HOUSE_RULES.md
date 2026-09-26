# House rules — KAGO

> **What this file is.** Tier 4 of the document taxonomy (`AGENT_GUIDE.md` → Document taxonomy): local
> law that governs this project and travels nowhere. `AGENT_GUIDE.md` answers HOW the agent works (the
> KAIF method); this file answers WITH WHAT it works here — the owner's standing rules, the stands,
> the machine, the routes and the tools of KAGO. It is outside the nine re-read core documents and has
> no size budget; `/resume` reads it at session entry, and the context router sends a task on a surface
> the project already touched here first. Started from `.kaif/_house-rules-template.md` (KAIF 2.8).
>
> **Language — English, a decision `[AI]` of 2026-09-26, veto open.** The skeleton expects the owner's
> language because it expects the owner to read this file. In KAGO the owner reads `ЗАКАЗ.md`,
> `STATUS.md` and `GOAL.md`; everything here was moved from the English agent guide and is read by the
> agent (`AGENT_GUIDE.md` → Languages: only the agent reads it → English). The owner's operative
> decisions live in `ЗАКАЗ.md`, in Russian, approved by him.

**Created:** 2026-09-26 · **Owner:** Mikalai Kryvusha (KOT KRINIK) · **Moved here from the guide
(2026-09-26, the KAIF 2.8 update):** "Environment dossier" table → §4 · "Test harness" command table →
§3 · "Push / GitHub authentication" → §5 · "Tools" table → §6 · "Notes from the human" → §1 as strict
rules (their verbatim text → `PROJECT_HISTORY.md` → «📦 AGENT_GUIDE "Notes from the human" до KAIF 2.8»).

## 1. The owner's standing rules

Each rule is a strict rule in the agent's wording with ONE provenance line; the owner's verbatim words
stay at their source — the commit named, `GOAL.md` (the archive), the chronicle. The operative
definitions of the product (the four modes, acceptance, barriers, the unit of work, the moratorium) are
NOT restated here: they are `ЗАКАЗ.md`, approved by the owner and edited only by his word. Decisions he
gave after 2026-08-15 and not yet carried into `ЗАКАЗ.md` are `STATUS.md` → «Решено владельцем — действует».

### R1. Write in the register of a measuring instrument

1. Name a thing by its Russian technical term. A borrowed or transliterated word is not a term; a term
   with no Russian equivalent is expanded at its first use.
2. Reject colloquial synonyms, wit and metaphor — even a colloquial word the owner offers himself.
3. Apply this to everything the owner reads: chat replies, `STATUS.md`, `ЗАКАЗ.md`, `GOAL.md`,
   `MASTER_PLAN.md`, epic meta-plans, interviews, commit messages and every string a command prints.
- **Exception:** identifiers and agent-internal comments stay English (`AGENT_GUIDE.md` → Languages).

[OWNER] 2026-08-15 21:1x · commit 3b1efad («мы тут не прозу пишем, а серьезный инструмент, и пользуемся академическим и научным языком»); steps 1–3 and the Exception are the agent's `[AI]` rendering of it (the same commit: «записано … тремя пунктами»)

### R2. Handle the owner's machine carefully — this rule stands above every other

1. Before a state-changing action, look it up first and name the rollback.
2. Take the smallest reversible form of the action.
3. Re-read the state until it is stable, and report the numbers.
4. Read a permission entry as a permission, never as a reason to act.
- **Exception:** none. The step-by-step form is `AGENT_GUIDE.md` → «THE OWNER'S-MACHINE RULE».

[OWNER] 2026-08-10 · commit 8ef55af (the unedited original; the typo-fixed text, on his instruction — commit 5eeb8a8): «ТРИЖДЫЙ ДУМАЙ И ГУГЛИ, ПРЕЖДЕ ЧЕМ ЧТО_ТО ДЕЛАТЬ! НЕ ДОПУСКАЙ РАЗРУШИТЕЛЬНЫХ ДЕЙСТВИЙ»; steps 1–4 are the agent's `[AI]` — that commit's own message calls steps 1–3 the rule's «executable form» and step 4 one of its «two boundaries»

### R3. Occupy the screen and the card for measurement runs without asking

1. Run fullscreen loads, long burns and back-to-back series without a question.
2. This permits USING the machine, not CHANGING it: a GPU write still walks R2; installing software,
   touching the registry or writing outside the repository stays the destructive class.
- **Exception:** none.

[OWNER] 2026-08-10 19:4x · commit 08d47c6 («можешь занимать комп, не переживай по этому поводу»); the list of step 1 and step 2 are the agent's `[AI]` — its scope of the word and its boundary («Вместе с границей», the same commit)

### R4. Silence the card's background for a measurement, and bring it back after

1. Before a measurement run, stop the consumer apps that hold the GPU awake — NVIDIA Broadcast,
   LosslessScaling, PotPlayer, Chrome, the NVIDIA app overlay, the LG Hub tray; when the protection is armed
   for a run, stop Broadcast and Parsec with it, and raise them when the protection is taken off. The owner
   asked to wire this into the fuse itself — NOT done, an open debt (`PROJECT_HISTORY.md` → «Гашение фона
   перед прогоном — его слово 08.09»); until then it is done by hand.
2. Leave NordVPN, the IDE hosting the session and Docker with running containers alone.
3. When the run ends, start everything stopped again — `runs/restore-card-background.ps1`.
4. Compare stock and a mode under the SAME background and a load heavy enough to dominate it:
   silencing apps buys ~6 W and cannot reach the idle floor (`dwm.exe` stays; measured 2026-08-10).
- **Exception:** since 2026-09-25 `Stop-Process` does not keep Broadcast and Parsec down (a service
  and the NVIDIA launcher raise them — `STATUS.md` → machine state); then step 4 alone holds.

[OWNER] 2026-08-10 · commit 5eeb8a8 («при измерениях всё, что создаёт фоновую нагрузку — останавливай») · 2026-09-08 · commit 152013b («туши защитой бродкаст и парсек, и снятием защиты — поднимай назад»); the app list of step 1, step 3 beyond Broadcast and Parsec, and steps 2 and 4 are the agent's `[AI]` of 2026-08-10 — step 2 its boundary (it once named Parsec too, and the owner's later word took Parsec out of it), step 4 its measurement and conclusion; the Exception is the agent's `[AI]` observation of 2026-09-25

### R5. Put the owner's word above the PDF, and search the optimum on THIS card

1. Order of authority: the owner's spoken word > `RTX_5070Ti_Undervolting_Master_Plan.pdf` > tests >
   current code behaviour. Where the PDF disagrees with the owner, mark the PDF line superseded.
2. Treat every PDF figure (≥ 97 % of stock, −60…−80 W, −100…−120 W, ≤ 65 / 58 °C, "the knee") as a
   reference — never a target, never a pass/fail threshold.
3. Say "no loss" only after the meter's own run-to-run spread is measured and shown smaller than the
   effect; state the spread next to every delta.
4. Where the optimum is not measured yet, write «не измерено».
- **Exception:** none.

[OWNER] 2026-08-10 09:4x · commit 074b324 («ИСКАТЬ РЕАЛЬНЫЙ оптимум нашего конкретного экземпляра GPU» · «то, что я сказал в чат - вот это главнее»); the owner ranked his word above the PDF — the tail «> tests > current code behaviour» and the second sentence of step 1, the extension of step 2 from «97 %» to every PDF figure, and steps 3–4 are the agent's `[AI]` consequence; the operative line — `ЗАКАЗ.md` §2

### R6. Design a mode as «reduce the power while the price stays ≤ N»

1. Maximize the power reduction subject to the price paid ≤ N; performance is the currency, not the
   objective.
2. N belongs to the owner and is set per mode — the values in force are `ЗАКАЗ.md` §1.
3. Ask for a new N only with the measured power↔performance curve in hand.
4. Name every non-performance cost (a thinner margin, a fan floor) as part of the price.
- **Exception:** none.

[OWNER] 2026-08-10 · commit 074b324 («Снижаем потребление насколько можем до тех пор, пока не платим больше, чем N»); the clause «performance is the currency» of step 1 and steps 3–4 are the agent's `[AI]` consequence

### R7. Never pin the clock in a shipped mode

1. A mode keeps the card's whole dynamic range and runs it at less voltage; the frequency ceiling
   lives INSIDE the curve.
2. Lock the clock (`-lgc min=max`) only for a MEASUREMENT. A clock BOUND with `min < max` is not a pin
   (internal map R13).
- **Exception:** none.

[OWNER] 2026-08-10 · commit 8668893 («Я хочу, чтобы карта сама могла и разгоняться и снижать частоты, но работала на пониженном напряжении согласно кривой VF профиля»); the clause «the frequency ceiling lives INSIDE the curve» of step 1 and step 2 are the agent's `[AI]` (a measurement needs a held clock, EXP-0018); operative — `ЗАКАЗ.md` §1

### R8. Keep third-party GUI applications out of KAGO's dependencies

1. Add no third-party GUI application to KAGO's dependencies; this outranks the MSI Afterburner design
   of the source PDF (how it is satisfied — `researches/01`).
- **Exception:** none.

[OWNER] 2026-08-09 · commit 6238a84, the owner's original, typos kept («Не хочется GUI приложение сторонее иметь в зависимостиях для KAGO.»); «outranks the MSI Afterburner design of the source PDF» is the agent's `[AI]` reading of that word against the PDF

### R9. Remember the last shortcut-applied mode and re-apply it at boot

1. The mode a shortcut applied last is the mode autostart applies at the next boot.
- **Exception:** the tray and its `Exit` (reset to factory + removal from autostart) — the owner's
  decisions of 2026-08-23, `STATUS.md` → «Решено владельцем».

[OWNER] 2026-08-09 · commit 6238a84, the owner's original («последний установленный по ярлыку профиль - должен запоминаться для автозапуска на старте ПК»)

## 2. External systems and access

| System | What the agent does there | Entry point | Where the credentials live |
|---|---|---|---|
| GitHub — this repository | commit always; push on the owner's ask in the chat (`STATUS.md` → «Решено владельцем») | `git` · `gh` · https://github.com/MikalaiKryvusha/KAGO | keyring token of `gh` (§5) — never the secret itself |
| GitHub — the KAIF origin | file and deliver KAIF tickets and update field reports without asking (`AGENT_GUIDE.md` → Git workflow) | `node .kaif/kaif-core.mjs report <file>` · https://github.com/MikalaiKryvusha/KAIF | the same token |
| The owner's voice store | read the portrait before writing the owner's text | `d:\work\krinik_voice\` (§5) | local disk |

## 3. Stands, environments and devices

The command table of the test harness — moved verbatim from `AGENT_GUIDE.md` → "Test harness" on
2026-09-26 (two columns, as it was; the principle of the harness stays in the guide). ⚠️ It lags the
epics after 2026-08-29 like the tools table below; the live list of suites is `npm run selftest:all`,
the commands of the new path are `STATUS.md` → «Инструменты нового пути». Pointers inside the table
were written in the guide: «the terminology section above» is `AGENT_GUIDE.md` → «TERMINOLOGY THE
OWNER SETTLED».

| Command | What it does |
|---------|--------------|
| `npm run gpu:info` | Read-only probe: model, driver, VBIOS, power-limit range, clocks, temperature — plus the **supported-clock ladder** (phase 5's search space). Re-derives the numbers the plans rest on. |
| `npm run gpu:info -- --json` | Same, as JSON, ladder included — for diffing a profile's effect before/after. |
| `node tools/probe-offer.mjs` | **DOES THE CARD OFFER ABOVE ITS OWN MAXIMUM — read-only, the meter of `P83-AC6`.** Reads the effective V/F table and the offset vector (both *Stable*), then judges the offer on the points **we raised** (offset > 0) against `clocks.max.gr`, which is READ, never written into the code. The distinction is the whole instrument: this card's FACTORY top (3157…3172 MHz at rest) is itself above its 3090 maximum, so a meter reading "highest offer of any point" reddens on a factory card (`nvapi.mjs` → `highestRaisedOfferMhz`). Prints what it CANNOT say — whether the clock BOUND is armed: `nvidia-smi` publishes no such field at all, and at 180…3090 an idle check is degenerate. Evidence to `runs/probe-offer.json`; exit 1 on any exceedance. **`[NOT-TESTED]` — no selftest blocks of its own yet (named debt); its arithmetic was cross-checked against the curve document's inversion, 51 points of 51.** |
| `npm run mon -- --once` | One telemetry sample to stdout. |
| `npm run mon -- --seconds 30 --out runs/x.jsonl` | Sample into JSONL: monotonic index, sorted keys, no `Date.now()` in compared output. Only the driver's `t` column moves between two runs. |
| `npm run mon -- --check-decode` | **A guard, not a report.** Holds the throttle-bit table against the card's OWN named reasons, in both directions. Exit 1 on any disagreement. |
| `npm run events -- --last 24h` | **FIVE providers in TWO classes** over a window. Each carries its own status — `ok` / `no-events` / `error` — because "found nothing" and "could not look" are different answers. Four are `means: 'CRASH'` and vote through `verdictFor`; the fifth, `nvlddmkm`, is `means: 'SIGNAL'` — the display driver's OWN error channel, printed in its own СИГНАЛЫ section and structurally unable to produce a verdict (R4b-signal; `plans/29`). It is watched with an EMPTY id list, i.e. the whole provider. |
| `npm run events -- --fixtures` | The fault-parser fixture suite (P1-AC3) **plus the four class invariants**, 11 blocks, offline — `queryFaults` is not called in this mode at all. **Four fixtures captured off this machine, three constructed;** the filename says which. In the `selftest:all` battery since 2026-08-23: it had existed since phase 1 and the battery never called it, which is the `bugs/27` class one floor down. |
| `npm run stress -- --workload <name> --seconds N` | The three-way verdict: checksum vs golden **and** the event log over the same window → PASS / SDC / CRASH, or UNKNOWN when a comparison could not happen. |
| `npm run stress -- --workload <name> --transient` | The same, stepping the load between full and idle on config's duty cycle. **This is the shape that exposes an unsafe profile**; steady load is the wrong load. |
| `npm run stress -- --workload <name> --sustain N` | One burst holds the card for N seconds instead of one process per launch. **Turns 8 % utilization into 97 %** and prints the ЦЕНА line — ops/s on the GPU, duty factor, and the per-thread fault rate. The duration stays OUT of the golden's `args` stamp, so no baseline is invalidated. |
| `npm run stress -- --workload <name> --lowload` | The OPPOSITE duty — 1 s on / 9 s off — holding the card at low clocks (measured: median 1237 MHz / 5 % against 2887 MHz / 97 % under load) and waking it repeatedly. **Proves nothing about heavy load and is not meant to:** an undervolt can survive every heavy test and die on a browser click, because the low end of the V/F curve has its own requirements. Asking for `--transient` and `--lowload` together is refused. |
| `npm run stress -- --capture-baseline` | Capture the golden references at stock plus the full card dump beside them. |
| `npm run stress -- --verify-baseline` | **P1-AC5 as a command:** every baseline carries its stamp, and every stamp still matches the card. |
| `npm run stress -- --selftest` | The verdict logic over all five outcomes, on injected data — runs without a GPU. |
| `npm run workloads:build` / `workloads:verify` | Build KAGO's own CUDA loads and prove determinism / re-check the manifest. |
| `npm run prove:gradient` | **Proves the SDC oracle's graded half can actually measure.** Builds a copy of `sdc_fma.cu` with one injected line — flip the lowest mantissa bit of element 123 on launch #5 — runs it, and demands the exact tuple `distinct=2 · bad_launches=1 · bad_elems_max=1 · bit_dist_min=1 · first_bad_index=123`. What it demonstrates is the whole reason the graded half exists: on that run the burst checksum still MATCHED the golden, so the old two-observation oracle returned PASS. The shipped binaries carry no corruption hook — the corruption lives only in the copy this tool builds. |
| `npm run curve -- --grids` | **The card's two dictionaries, as artifacts. Read-only.** Every voltage it can supply (the V/F table IS the voltage grid — 127 points, 450…1240 mV, spacing **5 mV ×94 and 10 mV ×32**, i.e. NOT uniform) and every clock it will run (389 values, 180…3090 MHz, steps 7 and 8). Each file carries its own re-probe command and the driver/VBIOS stamp. **A dictionary that fails its own validator is NOT written** — the first live run put an empty frequency grid on disk and only then printed the refusal. |
| `npm run curve -- --init` · `--show` · `--verify` | **The tuning-curve document — the search's memory. Read-only.** `--init` seeds 127 point objects from the live stock curve (frequency · voltage · status from a CLOSED vocabulary · date last edited); `--show` prints it with the coverage split; **`--verify` is the pair check against the live card**, on the voltage axis. Saves are atomic (temp + rename) because a hang is a NORMAL event during the sweep, by the owner's own decision. |
| `npm run journal -- --selftest` | **THE SWEEP'S WRITE-AHEAD JOURNAL — 17 blocks, sandboxed, no GPU** (epic 02 phase 2, `plans/15` §4.4). `runs/sweep/journal.jsonl` records the INTENTION to touch the card, `fsync`ed before the first byte reaches the GPU — because a hang hard enough to need the reset button takes the OS page cache with it, and a journal durable only when nothing went wrong is durable exactly never when it matters. **On the next launch an intent with no verdict IS the answer:** that rung is closed as `ЗАВИС` (`config.VERDICT.HUNG`, first-class beside `SDC`/`CRASH` by the owner's word) and attributed to its exact frequency and voltage. Keyed by FREQUENCY + VOLTAGE, never a table index. The only emergency stop left is **two CONSECUTIVE hangs on one rung** — cumulative counting would delete a probabilistic edge, which this card has shown. The suite photographs the production journal before and after (`bugs/08`), and it runs through `runSelfTest()` so a throwing assertion becomes ONE RED BLOCK instead of a dead report |
| `npm run curve -- --selftest` | **40 blocks**, no GPU — the count re-measured by a run on 2026-08-15 21:2x, not remembered. The suite header names its mutation addressees BEFORE the run (12 of them, EXP-0016); four were additionally re-proved by an INDEPENDENT judge mutation the same evening — the R13 ceiling, the closed status vocabulary, the atomic save, and «a voltage that is not on the card's grid» — each reddening its own block alone, with the intact code reddening none. **The row previously claimed 44 blocks and 13 mutations, and described a mutation block that does not exist in this suite** (the historically wrong R13 ceiling, judging the whole curve's top instead of what we raised — that one belongs to `nvapi --selftest-shape`). Two suites had been glued into one row, and three documents carried three different counts for one fact; corrected by running it. |
| `npm run curvemap` · `-- --selftest` · `node tools/build-curve-map.mjs [--png <file>]` | **THE CURVE MAP — ONE RENDERER FOR TWO SURFACES (`plans/85`), read-only.** `curve-map.mjs` takes its facts from the document and from the journal's PURE readers (`provenRungs` · `hangFloors` · `corrections`, never `resumeState`) and draws stock · our effective line (the whole document; empty when nothing is measured) · proven dots · the ENGINE'S hang floors · contradictions to REMEASURE (hollow «ПЕРЕМЕРИТЬ» — a recorded hang refuted by a deeper pass and NOT yet corrected in the journal; the caption vanishes with the layer, `plans/86`) · the rung under test. The static page `assets/curve-map.html` and the watch window's «КРИВАЯ» widget (`GET /curve.svg?mhz&mv&stock`, data paths via `--curve` / `--journal`) are the same picture in two skins; `--png` renders 3840×2160 with the owner's browser. **28 blocks**, mutation addressees named in the header; the window's suite grew 76 → 87 for the route, the page structure and the reader-only wiring. |
| `node tools/curve-editor.mjs [--port 17387] [--open]` · `--selftest` | **THE OWNER'S CURVE EDITOR — read-only toward the card, the document and the profiles** (the owner, 2026-09-14: *«сделай её интерактивной, чтобы я мог покрутить точки… кнопка [Сохранить]»*). A 127.0.0.1 page: the corners of the EFFECTIVE line (`curve-map.effectiveCurve`, facts via `loadFacts`) are dragged on the card's grid/ladder; `/preview` flags what the edit ADDS against today's curve — at/below the engine's hang floor, deeper than proven (proof inherited DOWNWARD in frequency) — apart from what today's curve already carries; **Save writes only `curves/edits/<moment>.json`** (corners + 389 derived rows + the source's sha256). Putting an edit into a profile is a separate act. `/?start=<curves/edits|proposals file>&compare=<file>` opens a saved curve (purple) against another (orange) with its found edges as diamonds; walls the physics lint refutes (`bugs/124`, `contradictions()`) are drawn hollow and never flagged red. 15 blocks (incl. «a page opens in a browser window, never explorer.exe»); port 8787 is taken on this machine by a foreign `web-smoke` server. |
| `node tools/curve-proposal.mjs [--write]` · `--selftest` | **THE AGENT'S CURVE FROM THE EDGES THE CARD REALLY SHOWED — read-only, writes `curves/proposals/<moment>.json`** (the owner, 2026-09-14: *«твой вариант кривой — на основе тех краёв, которые мы реально нашли… интерполяция и экстраполяция»*). Every rule is owner-sourced and named in the file: delivered frequency (GOAL «ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ») · passes only from `ORACLE_DATE` on, 04.09 off-post rows out (`interviews/026` Q1 = B, constants imported from `mark-unwatched-rows.mjs`) · a failure refuted by a pass at ≥ frequency and lower voltage is not an edge (`bugs/124`) · working point = last stable + one grid step (GOAL «КРИТЕРИЙ ПРИЁМКИ») · the curve = stock minus a least-squares TREND of the edges' depths shifted to touch the most demanding edge (owner: «ну так проведи тренд», experiment №2) · an edge whose last stable is inherited floored at hang + two grid steps · below the lowest / above the highest edge not deeper than it, and ≥ «top edge + 25 mV» above (`plans/25` «решено владельцем» п. 2). The written file carries `trend` (a, b, shift, RMS, margins). Earlier editions (convex hull = experiment №1, through-edges) are in git history. Passes through `harvestFromJournal`, never `resumeState`. **`--margin <mV>` · `--band-margins a,…,g` (epic 101 Ф1 Ш1, `plans/102`): the curve «touching trend + a margin per band» over the seven bands of `researches/39` §4 (`BANDS`, one constant; margin 0 = the trend curve, a negative margin or a band hole is refused by name); `--write` then writes that curve with `bands` · `margins` · `perBand`.** 28 blocks; mutations MB1–MB3 named in the suite header, each reddening its own blocks. |
| `npm run validate -- --selftest` · `-- --plan [--minutes N]` | **THE MODE CHECK'S CORE — epic 101 Ф1 Ш3/Ш4-offline/Ш5/Ш6 (`plans/102`), offline, touches no card.** `--plan` prints the mix of loads (`CANONICAL_MIX`, 1180 s: idle · Q2RTX · 10 transitions · burn 3→0 · Q2RTX · idle; `planMix` scales it, idle on both ends and ≥ 2 transitions always kept). The check's write-ahead journal `runs/validate/journal.jsonl` (the sweep journal's `appendLine`/`fsync`, one definition; an intent nobody closed = FAILED/death in the band of the LAST durable telemetry sample, none → band unknown, never invented) · `verdictOf` (driver voice · a stage that died · a sampler gap > `PULSE_STALL_MS`; no telemetry → UNKNOWN) · `hitMap`/`visitedBands` (time per band; visited ≥ `MIN_BAND_DWELL_S`) · `nextMargins` (pass → visited bands −`MARGIN_DESCENT_STEP_MV`; failure → its band + `RATCHET_GRID_STEPS` grid steps and floored there) · `modesValidated` — the first line of `npm run curve -- --progress`, «РЕЖИМОВ ПРОВЕРЕНО Y/4». Numbers in `config.mjs` §10 (`MODE_BANDS` shared with the curve builder). 38 blocks; mutations MV1–MV11 named in the header, each red on target. `runCheck` fixes the executor's ORDER on injected seams (intent fsync → sampler → apply → stages to the first failure → rollback in `finally` → verdict); `makeCardSeams` wires the REAL ones (apply with draft consent · `resetToFactory` · separate sampler · `runTimedemo` · burn levels) — proved on a fake library, NEVER yet run on the card (Ш8). Offline instruments on recorded data: `--hits <sampler.jsonl>` (visit map) · `--compare --stock <captures> --mode <captures>` (benefit table) · `--replay <capture.json> [--stock …]` (the whole post-check half + report, sandbox journal). |
| `npm run vgpu -- --derive` · `--show <card>` · `--selftest` | **THE VIRTUAL CARD — offline, and it cannot touch the GPU at all** (epic 03, `plans/16`). `--derive` builds `benches/cards/<name>.json` from the measured `curves/*.json` by a stated rule rather than by hand; `--show` prints a card; `--selftest` is 37 blocks, 8 mutations. It implements the SAME three seams the live card is driven through, and its curve backend calls the SAME `buildRaiseAndCapVector` and the SAME `curveWriteRefusal` — a double that refused less than the card would make every later green a lie. **Every output ends with the provability line, and that line is the instrument's most important field:** a green run here proves the engine's LOGIC and says nothing about silicon, driver, or a clock pin. |
| `npm run profiles` | Loads every file in `profiles/` against the LIVE card and prints it. Proves each profile's clock sits on the card's measured ladder, its power limit inside the card's range, and its stamp still matches the driver/VBIOS in front of us (R6). Read-only. |
| `npm run profiles -- --selftest` | **The format's guard, and it runs without a GPU.** 17 hostile fixtures, each carrying exactly one defect and naming the field the validator must point at. Mutation-proved: breaking the ladder check, the stamp-required derivation, or the `takenAt` offset rule each turns blocks red. |
| `npm run power -- --capture --workload <name> --seconds N --sustain N --label <l>` | **The METER for a power delta, with the verdict riding in the same record.** Samples telemetry from a SEPARATE process (an in-process sampler records zero — `spawnSync` blocks the event loop), splits the run into its loaded and idle halves, and stores medians + the GPU-client background + the stamp into `runs/power/<l>.json`. `--repeat N` takes a series. Read-only with respect to GPU state. |
| `npm run power -- --spread <label-prefix>` | **The number without which no delta may be called an effect.** The meter's own run-to-run scatter across the matching captures — watts, temperature, fan, clock, AND the price (ops/s) — and it REFUSES to compare records whose driver, VBIOS, workload, arguments, shape or profile differ (EXP-0011). Measured at stock on this card: **1.28 W = 0.65 % over ten runs, price 0.18 %.** A background difference is named, not refused. |
| `npm run power -- --selftest` | 28 blocks on injected data, no GPU. Mutation-proved: seven guarantees broken one at a time, each reddening the block that belongs to it (EXP-0016). |
| `npm run descend -- --points 2400,1800,1200` | **WRITES TO THE GPU.** Locks each ladder point through `profile-manager` (rule R1), measures it, and **releases the card in a `finally` after every candidate** — including on a failed capture, and aborting the whole descent if a release itself ever fails. Prints the power↔performance curve with the meter's floor applied. `--dry-run` plans and snaps without writing. |
| `npm run descend -- --selftest` | 39 blocks, no GPU: the safety shape driven through an injected backend and an injected meter (apply fails · capture fails · release fails), the lock proof, the ladder snap, the price rows. Mutation-proved with twelve mutations, each reddening its own block. |
| `npm run nvapi` / `-- --curve` / `-- --control` | The NVAPI bridge, read-only: resolve all 17 ids, prove the chain on the driver version and card name `nvidia-smi` already gave us, read the 128-point V/F curve, read the per-point offsets. |
| `npm run nvapi -- --fans` | **Read-only.** Every cooler this card reports, its level, its rpm, and **the floor the card names itself** — which is how the 30 % phase 2 kept seeing on five ladder rungs turned out to be a firmware floor rather than the stock curve's landing spot. Holds our decode against `nvidia-smi`'s `fan.speed`, an instrument we did not author, and refuses to look sane on a count of 0 or 32. |
| `npm run nvapi -- --fan-write <level> [--cool-to <°C>]` | **WRITES TO THE GPU (fan policy), under an armed watchdog.** Manual level on every cooler, read back until the commanded value is actually REACHED — a fan ramps, so agreement alone would accept a plateau on the way up (EXP-0028) — with `controlMode = AUTO` as the rollback, executed in a `finally` and verified. Only ever writes UPWARD: a fan stuck high costs noise, a fan stuck low costs the card. `--cool-to` is the owner's cold-start protocol, and it declines to write at all when the card is already colder than the setpoint. Measured: a start temperature repeatable within **1 °C**. |
| `npm run nvml` | **The NVML bridge, read-only — and NOT a backend.** Driver and card name (a third independent reading of both), the current clock offset, and the **allowed offset range** per domain, which `ClkDomainsGetInfo` never yielded. Quarantined by design: `researches/05` §5.5 records that NVML and NvAPI clobber each other on the same state, so NVML is an INSTRUMENT KAGO reads with, never a path it applies profiles through (rule R1 stays with `profile-manager.mjs`). |
| `npm run nvml -- --find-offset-field <MHz> [--mem]` | **WRITES TO THE GPU.** The ruler: apply a known offset through NVIDIA's documented `nvmlDeviceSetClockOffsets`, re-read our undocumented NvAPI struct before and after, and derive the record geometry **arithmetically from the changed addresses** rather than by eye. Rollback (the same call with 0) runs in a `finally` on every path, and the full 9 248-byte struct is compared byte for byte afterwards. `--mem` drives the memory lever — the run that proved this struct is graphics-only. |
| `npm run nvml -- --probe-mask` | Read-only under the lever: asks the control structure with three masks (all bits / none / one) to find out what the mask actually selects. This is the run that found the array base — a single bit for point 64 answered in slot 65. |
| `npm run nvapi -- --prove-mask <point> <-MHz>` | **WRITES TO THE GPU, with KAGO's own code.** The addressed write and the mask proof in one: exactly one entry may change and it must be the one addressed, the value must read back equal, the curve must move only at that point (or be at the clock floor, which is asserted as its own named case), and the rollback must return all 9 248 bytes. Refuses a positive offset — that direction is the undervolt and is not taken casually. `--zero-filled` repeats it without the read-modify-write, which is how we know RMW was not what fixed the silent no-op. |
| `npm run nvml -- --verify-decode` | **WRITES TO THE GPU.** The guard the corrected decode was born with: one raw buffer read through BOTH layouts, demanding the measured one (stride 0x24, field +0x14) sees the applied offset in 127 entries and the **published one (stride 0x48, field +0x00) fails to** — a check that goes red for its own reason (EXP-0016), against the layout this project believed until 2026-08-10. |
| `npm run vfstep -- --point 95 --mhz 15 --workload sdc_fma --seconds 30` | ⚠️ *Phase-5 tool; its `--point` flag carries the RETIRED index vocabulary and epic 02 replaces it — see the terminology section above.* **THE UNDERVOLT — WRITES TO THE GPU under an armed watchdog.** The atom of phase 5's search: one point, one step UP (a positive offset = the same frequency at less voltage), the full three-way verdict under real load, rollback in a `finally`. The default point is a MEASUREMENT, not a preference — point 95 is 1045 mV / 2842.0 MHz, exactly where this card sits under sustained load, and a step applied anywhere else would not be exercised by the load. `--dry-run` prints the plan and the snapshot without writing. |
| `npm run gfx -- --prove-not-capped` | **THE GATE OF THE GRAPHICS BENCH, and it runs BEFORE any FPS number is believed.** Two launches with the frame cost changed by a large factor; the FPS must MOVE by ≥ 5 %. A quantity that ignores a large change in its input is not measuring its input — this project already reported a clamp as "an extraordinarily precise instrument" and the owner recognized it as his television's 144 Hz (EXP-0032, STATUS fact 17). |
| `npm run gfx -- --run` / `--dry-run` | One Q2RTX timedemo launch, FPS parsed out of the engine's own console log, the cold opening run dropped AND named. `--dry-run` prints the command and launches nothing. Read-only with respect to GPU state: it runs a game on the card and sets nothing. |
| `npm run gfx -- --capture --label <l> [--profile <p>]` | The same run with telemetry sampled from a SEPARATE process and the Windows fault window over the same interval, into `runs/graphics/<l>.json`. **It never returns PASS**: there is no golden-reference comparison on the graphics path, so a clean run is reported as `faultFree` — this load carries the CRASH half and the THROUGHPUT half of R4, and says out loud that it lacks the checksum half. |
| `npm run gfx -- --spread <label-prefix>` | The bench's own run-to-run floor ACROSS launches — the only scatter figure that may judge the owner's «просадка FPS не более 5 %». Refuses to compare records whose demo, ray count, cvars, profile, driver/VBIOS or **desktop geometry** differ: in fullscreen this engine renders at the desktop's resolution, and the owner changes that without telling anyone. |
| `npm run gfx -- --selftest` | 39 blocks, no GPU and no game. Mutation-proved with seven mutations, each reddening its own named block. |
| `npm run vfstep -- --set --point N --mhz M --cap C` | **THE UNDERVOLT JUDGED BY THE DIVERSE SET — WRITES, under an armed watchdog.** One write to the curve, one lease sized for the WHOLE set, three loads inside (`sdc_fma --transient` first — voltage noise lives in the transitions — then `sdc_fma --sustain` and `branchy --sustain`), the point's verdict is the WORST of them and the deciding shape is named. The goldens' stamps are checked BEFORE the first watt, so a stale reference costs zero card time. Rollback is a LIST, not a chain (R10a). |
| `npm run vfstep -- --selftest` | 16 blocks, no GPU: the UNDO SHAPE driven on injected functions — a throwing step must not cancel the ones behind it — plus the voltage ladder with the curve-floor trap. Mutation-proved three times, including one that restores the abort-on-throw the `finally` used to have. |
| `npm run engine -- --band 500,1100,…` | **THE BAND SWEEP — WRITES.** For each frequency: raise the WHOLE curve (a single point cannot cheapen a clock its neighbour serves — `bugs/02`), **PIN the clock** so the curve region under test is the region actually loaded, judge by the set, release and zero in a `finally`. The ladder is stepped in **millivolts computed from the card's own curve**, because one voltage grid step costs 4.1 MHz of offset at 2842 MHz and 22.2 MHz at 1700. `--dry-run` prints the plan, the rung count per frequency, and **the depth of the first step** — the number whose absence cost the owner a night. |
| **`npm run engine -- --sweep --from <МГц> --to <МГц> --dry-run`** | **THE SWEEP'S PLAN — read-only, and rail S2 makes the operator read it BEFORE the run** (`plans/15` §4.7). Per frequency: the seed and the neighbour it came from · the rung count · **the depth of the FIRST step** · the policy zones crossed and how often the grid forced a deeper one · the lever's reach · **who would hold the ceiling — the curve or the clock pin — asked of `chooseWriteShape` on the REAL vector** · and, when a seed exists, the FALL-BACK ladder from stock, because a rejected seed drops the descent there. Computed by the same `planFrequency` the run walks, so it cannot advertise a ladder the run will not take (`bugs/09`, EXP-0052; F2-AC8 compares them block-by-block). Opens no journal, arms nothing, exits 1 if any frequency would be refused. |
| **`npm run engine -- --sweep --from <МГц> --to <МГц>`** | **THE SWEEP — WRITES TO THE GPU, and it is the command epic 02 exists to produce.** Walks the card's frequency ladder top-down by RUNG (389 frequencies over 127 voltage rungs; the rung is burned at its HIGHEST frequency and the rest inherit downward — E2-AC3), seeds each descent from the proven higher neighbour, descends on the owner's 25/10/5 mV policy, refines a coarse failure at the card's own step, and closes every frequency with one of **TWO** verdicts — `edge-found` or `lever-limited`. Each closed point is validated and saved to the tuning-curve document BEFORE the next rung starts. **The same command RESUMES an interrupted sweep**: the write-ahead journal is what tells a fresh start from a continuation, an intent nobody closed becomes `ЗАВИС`, and two consecutive hangs on one rung stop the run non-zero. `watchdog --recover` runs once, first. **[NOT-TESTED] on live hardware — that is phase 3, with the owner present.** |
| `npm run pulse -- --rung-profile` | **WHERE a rung's idle time actually sits — read-only, two files, no GPU** (`bugs/53`). Lays the sampler's telemetry over the journal's rung windows and prints the second-by-second load/idle shape averaged over every rung of a run, plus the gap between rungs. It exists because a quarter of a run showing as «idle» has three completely different remedies depending on WHERE the idle is, and the project was about to optimize without knowing which. **Measured 2026-08-26 on four consecutive runs: the between-rung gap is 0.0 s** — every idle second is inside a rung, as a 3 s head (curve write, watchdog arm, golden stamps) and a 3 s tail (rollback, disarm), with the middle belonging to the burn's shape rather than to the machinery. The threshold that splits loaded from idle is the SAME 50 % of `utilization.gpu` that `power-baseline` uses; one concept, one number. |
| `npm run watchdog -- --status` | Read-only: what is holding the card right now, whether its owner is alive, how long the lease has left, and what the undo would be. |
| `npm run watchdog -- --drill` | **WRITES TO THE GPU — the rehearsal.** A victim process really changes the card and dies WITHOUT disarming (`process.exit`, so no `finally` runs); the detached guard must restore the card on its own. Measured: 2.5 s from death to a clean card. A watchdog that has never fired is worth nothing, so this is the command that makes it believable. |
| `npm run watchdog -- --recover` | **WRITES TO THE GPU.** A record found at rest means a previous run died holding the card: reset to factory and report. Risky write paths call this at startup — never begin new work on a state nobody can describe. |
| `npm run watchdog -- --selftest` | 20 blocks, no GPU: the firing decision on an injected clock and an injected card. Mutation-proved with five mutations, each reddening its own block — including the ordering rule that the record is taken away BEFORE the reset, which needs a fixture only that rule can fail. |
| `nvidia-smi -q -d SUPPORTED_CLOCKS,PERFORMANCE,POWER` | The raw driver view when the wrapper is not enough. |

> **`runs/` is git-ignored, so the golden reference is LOCAL STATE.** A fresh clone has no baseline
> and `npm run stress` answers UNKNOWN until `--capture-baseline` has run once. The shipped copy of
> the same fact is `workloads/MANIFEST.json`. The tester deliberately does NOT fall back to it — a
> missing baseline must be visible, not papered over.

## 4. Environment dossier — the facts of the machine

The rule — `AGENT_GUIDE.md` → "Environment dossier"; `/refresh-context` regenerates this table (its
dossier step). Moved verbatim from the guide on 2026-09-26; one repair on the move — the `/tmp` row
said `D:` + a TAB + `mp` where `D:\tmp` was written (a backslash eaten by a tool, EXP-0190 class).

> **Environment dossier.** Taken: `2026-08-09`, extended `2026-08-10` (phase-1 harness rows) · Regeneration: `/refresh-context` → the dossier step
> (re-run the probes in column 3 and rewrite the values and this date) · **Staleness: facts older
> than four weeks are HYPOTHESES — re-probe before relying on them.**

| Fact | Value | Probe |
|---|---|---|
| OS | Windows 11 Pro 10.0.26200 | `cmd /c ver` |
| GPU (the subject under test) | GeForce RTX 5070 Ti · driver **616.92 since ≤ 2026-09-18 23:01** (read 2026-09-25 by `curve --verify`; every curve, edge and profile before that date is stamped **610.88** — R6) · VBIOS 98.03.58.40.8b · power limit 250–300 W · max clock 3090 MHz. **Supported-clock ladder (phase 5's search space):** 5 memory rungs (405 / 810 / 7001 / 13801 / 14001 MHz); the four full rungs each offer the SAME 389 graphics points, 180…3090 MHz, gap alternating 7 and 8 MHz — so the clock grid is measured, while the VOLTAGE grid stays unmeasured until phase 4 | `npm run gpu:info` |
| CPU / RAM | AMD Ryzen 7 5700G · 8 cores / 16 threads · base 3801 MHz · 32 GB (4 × 8 GB Kingston @ 3200). **Measured 2026-09-07: L3 is 16 MB** — this is an APU die, HALF the 5800X on the same AM4 socket — and **the card's link is capped at PCIe Gen 3 by the HOST** (`Device Max 5 · Host Max 3 · Current 3 · width x16 · Replays 0`). Both numbers matter to this project: under a live game the GPU sits cold at max clock with ZERO throttle reasons while one core hits 100 % — the platform, not the card, is the ceiling, which is why **the graphics bench cannot measure the owner's «FPS drop ≤ 5 %» criterion** (`bugs/113`, `researches/34`) | `Get-CimInstance Win32_Processor` · `Get-CimInstance Win32_CacheMemory` · `Get-CimInstance Win32_ComputerSystem` · `nvidia-smi -q` → GPU Link Info |
| Display and disks (they shape every live measurement) | Desktop **3840×2160 @ 144 Hz** on the NVIDIA card, one live monitor — **plus TWO enabled virtual display adapters** (`Sunshine Virtual Display Driver`, `SudoMaker Virtual Display Adapter`) that sit in the present path. Five SSDs; **`D:` is 93 % full (65.9 of 953.9 GB) and carries BOTH the games and the pagefile**; `F:` is the roomy one (359 GB free). A game run WINDOWED is capped by the compositor: measured 83 % / 218 W windowed against 96 % / 257 W fullscreen | `Win32_VideoController` · `Win32_PnPEntity` · `Win32_LogicalDisk` · `Win32_PageFileSetting` |
| Shells available | PowerShell 5.1 (`powershell.exe`, primary) · Git Bash (MSYS2, `/usr/bin/bash`) | `$PSVersionTable` · `bash --version` |
| Console / ANSI encoding | console codepage **65001**, `[Console]` in/out **utf-8** — but the **default ANSI is windows-1251**, so PowerShell 5 `Set-Content`/`Add-Content` without `-Encoding utf8` writes cp1251 — **and WITH `-Encoding utf8` it writes a BOM, which Node's `JSON.parse` rejects** (paid 2026-08-14: three profile JSONs broke silently; caught by a parse probe). JSON and code files are written with the agent's file tools or Node, never with `Set-Content` | `chcp` · `[Console]::OutputEncoding` · `[System.Text.Encoding]::Default` · `node -e "console.log(require('fs').readFileSync(f,'utf8').charCodeAt(0)===0xFEFF)"` |
| Locale per shell | PowerShell: culture `ru-RU`, UI culture `en-US` · Git Bash: `LANG` empty, `LC_CTYPE=C.UTF-8` | `Get-Culture` · `Get-UICulture` · `locale` |
| Runtimes and build tools | Node v24.15.0 · npm bundled · Python 3.14 (**no pip**) and Python 3.10 (**pip 24.2 — use this one**) · git 2.43.0.windows.1 · gh 2.95.0 | `node -v` · `python -V` · `git --version` · `gh --version` |
| CUDA build toolchain | **CUDA Toolkit 13.3 with `nvcc`** on PATH (`…\CUDA\v13.3\bin`). `nvcc` needs an MSVC host compiler and **does not find one on its own** — load `vcvars64.bat` (or `vcvarsx86_amd64.bat` for the x86-hosted cross build, which is proven to work and yields the same checksum). MSVC lives under VS 2022 Community; locate it with `vswhere`, never by a hard-coded version path | `nvcc --version` · `vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath` |
| Windows Event Log access | `Get-WinEvent` on the `System` log works **unelevated**. Live providers: `Display` · `Microsoft-Windows-Kernel-Power` (id 41 has real history here) · `Microsoft-Windows-WHEA-Logger` (**no events at all** — detectors need fixtures) | `Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Display'} -MaxEvents 5` |
| `/tmp` from the Bash tool | **Not one path.** `/tmp` exists for bash itself (MSYS2 mount) and writes fine, but a NODE process launched from that same bash resolves `/tmp` to `D:\tmp`, which does not exist — `writeFileSync('/tmp/x')` fails ENOENT while the neighbouring `echo > /tmp/x` succeeds. Use the session scratchpad for anything a script must write | `node -e "console.log(require('path').resolve('/tmp'), require('fs').existsSync('/tmp'))"` vs `ls -d /tmp` |
| Windows event log, no-match detection | `Get-WinEvent` signals "no events" as an ERROR, and its message is localized (ru-RU here). The locale-independent discriminator is `$_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'` — matching the message text is a guard that works in one language only | `try { Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-WHEA-Logger'} -ErrorAction Stop } catch { $_.FullyQualifiedErrorId }` |
| Fault history available for proofs | `Kernel-Power` 41 — THREE real events (29.07, 05.08, 06.08.2026), so that detector is red-provable here. `Display` has 4107 events but no 4101; `WHEA-Logger` and `WER-SystemErrorReporting` have **zero events of any id** — those detectors are fixture-provable only | `npm run events -- --since 2026-07-01 --until 2026-08-10` |
| Workload burst cost | One workload run is one PROCESS, and startup dwarfs the kernel. **Re-measured 2026-08-10 at DEFAULT arguments, hammering `sdc_fma.exe` in a loop for 12 s: 91 launches = 7.6/s = 132 ms per launch, of which the kernel is 0–1 ms — 99.2 % of wall time is process startup. Card reached utilization median 8 % (max 9), 61.7 W of a 300 W limit, clock 2670 MHz, fan 0.** The earlier note recorded 20–30 % and a 0–25 ms kernel; those came from other arguments, and a value is only true under the conditions it was taken (EXP-0011) — hence both are stated with theirs. **A second consequence found the same day: the workload's own `ms=` field is whole MILLISECONDS while the kernel takes 0–1 ms, so it is useless as a throughput meter — the sustained shape must count launches over SECONDS instead.** Phase 5 (and now phase 2 §4.3) needs a workload that loops internally for N seconds | `for i in 1 2 3 4 5; do ./workloads/sdc_fma.exe; done` for the kernel time · a 12 s hammer loop alongside `npm run mon -- --seconds 10 --out runs/x.jsonl` for the utilization |
| `tar` / `curl` / `find` per shell | **Different worlds — check the TYPE.** PowerShell: `tar` = `C:\Windows\system32\tar.exe` (bsdtar) · `curl` = an **ALIAS to `Invoke-WebRequest`**, not curl.exe · `find` = `C:\Windows\system32\find.exe` (the DOS text filter, NOT GNU find). Git Bash: `tar` = `/usr/bin/tar` · `curl` = `/mingw64/bin/curl` · `find` = `/usr/bin/find` | `type tar` in EACH shell (not `which`) · `Get-Command tar` |
| Windows slash-flags from Git Bash | **MSYS2 rewrites `/Flag` arguments into PATHS before the program sees them** — `schtasks /Run /TN x` arrives as `C:/Program Files/Git/Run` and fails (paid 2026-08-14, EXP-0043). Native Windows CLIs whose flags start with `/` (`schtasks`, `taskkill`, `reg`, `sc`, `net`, `icacls`) are driven from PowerShell (or `spawnSync` from Node with an argv array) — never from bash. `MSYS2_ARG_CONV_EXCL='*'` exists but a per-call env crutch is worse than picking the right shell | `bash -c "schtasks /Query /TN whatever"` → error naming `C:/Program Files/Git/Query` |
| VCS line-ending policy | `core.autocrlf = true` · credential helper `manager` | `git config --get core.autocrlf` · `git config --get credential.helper` |
| Env vars that do NOT propagate to children | `ProgramFiles` set in a PowerShell session does **not** reach a child process — Windows hands new processes its own value. `PATH` and `CUDA_PATH` propagate normally. Cost the first attempt at proving a refusal path; test such branches through an injected seam, not by editing the environment | `$env:ProgramFiles='X'; node -e "console.log(process.env.ProgramFiles)"` |
| Package manager | winget · chocolatey · npm | `winget -v` · `choco -v` |
| Spawning `npm` from a Node script | **`execFileSync('npm.cmd', …)` FAILS on this Node.** Node 24 refuses to execFile a `.cmd`/`.bat` without `shell: true` (the CVE-2024-27980 hardening), and the failure is quiet if the caller swallows stderr: a measurement harness reported "45 → 45 °C, verdict not found" three cycles in a row because every child had died before starting. Call the module directly — `execFileSync(process.execPath, ['<repo>/automation-engine/lib/x.mjs', …])` — which removes the shell from the path entirely and is what the project's own tooling does | `node -e "require('child_process').execFileSync('npm.cmd',['-v'])"` — throws EINVAL |
| Fan control (this card) | **3 coolers · 3 000 rpm ceiling each · the card's OWN manual floor is 30 %** (`currentMinLevel`), while AUTO still reaches 0 % in zero-RPM. Manual writes are accepted and obeyed; a forced cool-down lands the start temperature within **1 °C** across cycles. **A fan RAMPS (~8 s to target), so a read-back needs the TARGET and not just two agreeing samples — EXP-0028** | `npm run nvapi -- --fans` (read-only) |
| PDF text extraction | `pdftotext` at `/mingw64/bin` — **but it silently drops Cyrillic** on these PDFs (no ToUnicode map). PyMuPDF under Python 3.10 extracts it correctly. `pdftoppm`/`pdffonts` are absent; ImageMagick is present but has no Ghostscript delegate, so PDF→image does not work | `pdftotext -layout in.pdf out.txt` · `py310 -c "import pymupdf"` |
| Quirks paid for by incidents | see `EXPERIENCE.md` — EXP-0003…EXP-0005 (tooling, winget), EXP-0007 (Grep is not byte-faithful), EXP-0008 (prove a guard red against `HEAD`), EXP-0009 (a summarized bug doc is not an inventory), EXP-0010 (Read renders NUL bytes as spaces), **EXP-0122 (Cyrillic in a `.ps1` SOURCE is a PARSE error — the file tools write UTF-8 without BOM and PowerShell 5.1 reads that as windows-1251; keep throwaway `.ps1` ASCII-only)** | `grep -n 'EXP-00\|EXP-01' EXPERIENCE.md` |

## 5. Routes, recipes and conventions — the index of own work

| Surface | Where the work lives | What it covers |
|---|---|---|
| Push and forge authentication | `gh auth setup-git` | `gh` is authenticated as **MikalaiKryvusha** over HTTPS with a keyring-stored token (scopes `gist`, `read:org`, `repo`); git uses that token as its credential helper, so `git push` needs no separate credentials. Push fails: non-fast-forward → `git pull --rebase` → push again; auth failure → `gh auth status`, then `gh auth login` if the token is gone |
| The owner's voice portrait | `AUTHOR_STYLOMETRY.md` in the project root, git-ignored; its one source is the owner's voice store `d:\work\krinik_voice\` (decision №39: one portrait per owner, not per project) | the **full private core**, installed in this project on 2026-08-09 on the owner's instruction (the guide's text of it, verbatim — `PROJECT_HISTORY.md` → «📦 AGENT_GUIDE "Notes from the human" до KAIF 2.8») so the agent works from the richest version, and deliberately not shipped: it carries verbatim quotes from the owner's personal writing and the repository is public, so the file is git-ignored and stays that way. A fresh clone fetches it: `cp d:\work\krinik_voice\AUTHOR_STYLOMETRY.md .`. Never edit the copy — edit the store and re-copy. The public quote-stripped snapshot in the KAIF repository is NOT what is installed here (the KAIF 2.8 update left the portrait untouched for that reason). Before any text the owner signs or reads as his own: `/owner-voice`, `AGENT_GUIDE.md` checklist step 19 |
| The card's measurement evenings | `STATUS.md` → «Эстафета», `ЗАКАЗ.md` §8 | a live evening at the card only with the owner at the machine; a mode check ≤ 5 min, a smoke of 30 s between tuning steps |
| Streaming host «Вайбполо» | `C:\Program Files\Apollo`, service `ApolloService`, `config\sunshine.conf` | the owner's Vibepollo (Apollo); `ping_timeout` is in milliseconds (60000 since 2026-09-25) |

## 6. Tools of this project

The tools table — moved verbatim from `AGENT_GUIDE.md` → "Tools" on 2026-09-26, together with its
own warning that it lags. The warning's pointer «Что работает на диске» no longer exists in `STATUS.md`
(rewritten 2026-09-25): the commands of the new path are `STATUS.md` → «Инструменты нового пути».

| Command | What it does |
|---------|--------------|
| `npm run check` | The build gate — parses every project `.mjs`. Exit 1 on the first syntax error. |
| `npm run gpu:info` | Read-only GPU probe (`--json` for machine output). |
| `npm run questions` | The questions guard — four axes plus the debt ratchet over the place-of-questions rule. |
| `npm run ask <doc.md>` (= `node tools/ask.mjs`) | **Since 2026-09-26 (KAIF 2.8, `plans/104`):** the owner-review page of the SHIPPED contour `.kaif/tools/contour/review.mjs`, with KAGO's voice (Silero «eugene») set for that child process only. Answers are saved one at a time, the page lives until the last question; run it as a tracked background task and next to it the waiter `node tools/ask.mjs --wait <doc.md>` (exit 0 on each recorded answer). `node tools/ask.mjs --call "<what is needed>"` — the call for the owner's hands or a quick answer (beeps → banner → voice, «Проект КАГО, …»); `--search "<question>"` — a prior answer before any question; `--help`. |
| `npm run ask:legacy <doc.md>` / `ask:batch` | The project's OWN contour `tools/review.mjs` (pre-2.8: the page closes on the first save) — kept reachable until the shipped one is seen working with the owner; `ask:batch` (one page over everything waiting) still runs on it. |
| `npm run verify:contour` | The owner-review contour's QA run — 18 blocks over hostile fixtures, ~4 s, no browser. `--only <id>` for one block. Run it after ANY edit to `review.mjs`, `review-core.mjs`, `review-gate.mjs` or `send-upstream.mjs`. |
| `npm run workloads:build` / `workloads:verify` | Build KAGO's own CUDA loads and prove determinism / re-check the manifest. |
| `npm run kaif:version` / `kaif:check` / `kaif:update` | KAIF machinery: report version, validate the deployment, update from origin. |
| `node .kaif/tools/kaif-canon-lint.mjs check` | Canon linter for the owner's canon artifacts. |
| `node .kaif/tools/kaif-provenance.mjs check` | `[AI]` provenance-mark integrity. |
| `npm run polygon -- --count N [--amplitude A] [--seed-base S]` | **ПОЛИГОН НЕИЗВЕСТНЫХ GPU, офлайн** (эпик 67 фаза 4). Гоняет N сгенерированных карт через ПОЛНЫЙ цикл движка ОТДЕЛЬНЫМ ПРОЦЕССОМ и судит каждый прогон шестью сторожами честности. Печатает покрытие по осям, ВРЕМЯ числом и строку «вымысел²». Замерено: **41 с на карту** на полосе из трёх частот. Живые артефакты сверяются отпечатком до и после. |
| `node automation-engine/lib/polygon-guards.mjs --selftest` | **Шесть инвариантов честности, каждый доказан КРАСНЫМ.** И1 закрытая строка не глубже выданного · И2 стоп именован и код выхода согласен · И3 журнал цел · И4 конверт · И5 живые артефакты · И6 вымысел не прячет от цикла свою физику. Судят улики, а не прогон, — поэтому дёшево краснеют. |
| `node automation-engine/lib/polygon-shrink.mjs --selftest` | **Сжатие ломающей карты:** бисекция амплитуды + зануление осей по одной, кандидат со СМЕНОЙ КЛАССА отвергается. Минимизируется ВХОД генератора, а не файл. |
| `npm run entryguard` · `-- --selftest` · `-- --freeze` | **THE ENTRY-GUARD LINT — the sixth gate of `npm run check` (`bugs/95`).** Every `tools/*.mjs` must carry an entry guard (`process.argv[1]` compared with `import.meta.url`), because in ESM an IMPORT IS A RUN: an unguarded tool executes its work with the IMPORTER's argv — `tidy.mjs` killed the owner's windows, `grant-agent-*` wrote his permissions file, an import loop rebuilt the burn binaries (EXP-0218). Debt lives in `decisions/entry-guard-baseline.json` and may only shrink: a fixed tool still listed there reddens too. **The form to copy is at the bottom of `tools/check.mjs`** — never invent your own. 7 blocks, mutation-proved; 2026-09-04: 34 tools, 0 unguarded. |
| `node tools/loop-guard.mjs --until <ISO>` | **ВНЕШНИЙ СТОРОЖ автономного цикла** (слой 2 `/guarded-loop`). Следит за возрастом последней строки `.kaif/heartbeat.log`; на застарелом пульсе ГОВОРИТ (журнал + уведомление владельцу), но ничего не убивает. Пороги из замера, `--until` обязателен — сторож без срока это заряженное ружьё. |

> ⚠️ **ТАБЛИЦА ВЫШЕ ОТСТАЛА, И ЭТО НАЗВАНО, А НЕ СПРЯТАНО (2026-08-29).** В ней нет команд
> нескольких последних эпиков — `npm run twin`, `npm run fuse`, `npm run team`, `npm run workplace`,
> `npm run deathwatch` и других. **Живой и полный список — `STATUS.md` → «Что работает на диске»**
> и вывод `npm run selftest:all`, который перечисляет ВСЕ наборы командой. Строки выше про полигон
> дописаны потому, что это своя новая машинерия; общую ревизию таблицы должен сделать отдельный
> проход, а не сессия, которая случайно на неё посмотрела.

## 7. Product knowledge

Not restated here: the product's operative definitions are `ЗАКАЗ.md`; the brand and names —
`AGENT_GUIDE.md` → «Project identity» and «THE NAMING RULE»; the owner's vocabulary (frequencies, not
numbered points) — `AGENT_GUIDE.md` → «TERMINOLOGY THE OWNER SETTLED».
