# Plan 06 — Epic 01 / Phase 3: the shell — four shortcuts, remembered state, autostart, passive tray

> **Created:** 2026-08-14 00:3x +03:00 (agent, on the owner's word: *«напишешь это в проекте,
> операционные карты по шагам, куда в этом проекте двигаться и как для достижения успеха»* — said
> after he named the previous sessions' planning debt out loud)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 3 (§3, §4, §9 track Б) · `MASTER_PLAN.md`
> phase 3. Evidence base: `researches/03` §3.6 (autostart + elevation via a scheduler task) ·
> `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §4 (four shortcuts, passive tray — the owner's design) ·
> `researches/01` (what the `nvidia-smi` backend can write)
> **Status:** 🟢 in flight — §4.1 closed 2026-08-14 00:5x · §4.2 closed 2026-08-14 01:0x ·
> §4.3 closed 2026-08-14 09:2x (live install + task-path proofs) · §4.4 mechanism proven live
> 2026-08-14 09:4x; **P3-AC2 series (5 natural logons) collecting in the journal** ·
> **§4.5 closed 2026-08-14 11:1x (tray live: P3-AC4 taken, mode track both ways)** · next §4.6
> (the phase judge; P3-AC2 may still be collecting — judge what is closable, name the series
> as the one open meter). Plan written BEFORE the first line of phase-3 code (EXP-0027 honoured)
> **Outbound:** a tray-implementation fork goes to the owner ONLY if §4.1's recon finds no
> third-party-GUI-free path · closure → `MASTER_PLAN.md` phase 3, epic AC1/AC2/AC6/AC7, internal map §4

---

## 0. Why this plan exists NOW, and why it does not wait for phase 5

Phase 3 was ordered BEFORE phases 4–5 in the epic (*«после фазы 3 у вас на руках законченный
полезный продукт»* — `plans/01_EPIC` §3) and was skipped; `STATUS.md` names it **the project's most
expensive debt**: everything measured so far, the owner cannot apply — he has not a single shortcut.
EXP-0027's rule — every phase in flight must have its operational plan before its first line of
code — is why this document precedes the work.

**This phase is deliberately NOT gated on phase 5.** It writes nothing to the V/F curve, so the
post-incident rule (live writes only with the owner at the machine, `bugs/03`) does not bind it —
the whole track runs autonomously. The one thing phase 5/6 will add later is NUMBERS inside the
profile artifacts; the shell is built as the finished socket for them.

## 1. Goal vector

**The pain.** KAGO can measure, write, guard and roll back — and the owner can operate none of it.
There is no shortcut, no remembered state, no autostart, no indicator. Every measured win is locked
inside `npm run` commands only the agent runs.

**Where we want to be.** Four desktop shortcuts — 🚀 Max Perfomance · ⚖️ Optimised · ❄️ Silent Cold ·
⏹ Stock Default (the owner's names, shipped as written) — each applying its profile through
`profile-manager` and confirming by read-back; the last applied mode remembered and re-applied at
logon; a passive tray icon showing the active mode; factory state always one shortcut (or one power
cycle) away. The three working modes ship as clearly-marked DRAFT profiles that the applier REFUSES
until phase 6 qualifies them — a shortcut on the owner's desktop must never be able to apply an
unproven undervolt.

**Goal types.** *Achieve* — the shell, end to end, mechanism proven. *Maintain* — factory state as
the default on every failure path; zero third-party GUI dependencies. *Avoid* — a boot or a click
that leaves the card in a state nobody verified.

## 2. Entry gate

| Gate | State | Evidence |
|---|---|---|
| Four-mode taxonomy recorded as the owner's decision | ✅ | `GOAL.md` → «Четыре режима», `MASTER_PLAN.md` |
| `profile-manager.mjs` interface with swappable backends (R1) | ✅ | phase 2/4 work; `npm run profiles` loads and validates |
| Stock Default works | ✅ | `npm run profile -- --reset` + watchdog full undo |
| Autostart + elevation path researched | ✅ | `researches/03` §3.6 — scheduler task, no UAC prompts |
| `npm run check` green | run at start | A0 of the epic's §9 route map |

Phase 5's state is explicitly NOT in this table.

## 3. Acceptance criteria

Per `REQUIREMENTS_FRAMEWORK.md` — Scale · Meter · Target.

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P3-AC1** | Every shortcut click ends in a VERIFIED state: applied-and-reread-matching, or refused-with-nothing-written. No third outcome. | Scale: clicks ending in an unverified or partial state · Meter: the applier's journal + card read-back (`gpu:info --json` diff) · **Target: 0.** Mechanism proven 2/2 on (Stock Default, the test profile); the epic's AC1 «4 из 4» closes in phase 6 when the three modes qualify — stated here so nobody claims it early |
| **P3-AC2** | A logon arrives at the remembered profile or at factory — never at an unverified intermediate (epic AC2). | Scale: logons ending in a verified state · Meter: the boot-apply journal, one record per logon, vs `gpu:info --json` · **Target: 5 of 5 consecutive logons** (the owner's natural reboots count; no reboot is forced for the series) |
| **P3-AC3** | An unqualified (draft) profile is REFUSED loudly, before any write. | Scale: draft-mode applications that wrote anything to the card · Meter: applier journal + read-back; a hostile fixture with `qualified: false` · **Target: 0, and the refusal message names the reason and the phase that will lift it** |
| **P3-AC4** | The tray owns no state: killing it changes nothing on the card (epic §4 phase-3 gate). | Scale: GPU state diffs across tray kill/restart · Meter: `gpu:info --json` before/after · **Target: 0 diffs** |
| **P3-AC5** | The reset shortcut is proven FROM a non-factory state (epic §4 phase-3 gate). | Scale: reset runs from a non-factory state ending at factory · Meter: read-back vs the factory snapshot · **Target: ≥ 1 proven run, in the same session as the test-profile apply** |
| **P3-AC6** | Zero third-party GUI applications in the dependency tree (epic AC6). | Scale: count · Meter: `package.json` + dependency tree read · **Target: 0** |
| **P3-AC7** | A profile whose driver/VBIOS stamp mismatches the live card is refused (epic AC7, rule R6). | Scale: stale-stamped applications that wrote · Meter: a doctored-stamp fixture through the applier · **Target: 0, refusal names the stamp pair** |

## 4. Steps

Each step cites its anchor (the citing rule). Fresh code is born `[NOT-TESTED]`; flips on observation.

### 4.1 — Recon: a tray icon with zero third-party GUI dependencies ✅ 2026-08-14 00:5x

*Anchor: `plans/01_EPIC` §9 track Б, step Б1; checklist step 9 — external truth (the Windows tray
API surface) gets a recon doc BEFORE code.*

- [x] `researches/07_tray_without_third_party_gui.md`: three candidates read from vendor docs
      (learn.microsoft.com notification-area page, dotnet/winforms source, PowerShell#3028) plus
      three probes on this machine (powershell 5.1 is STA by default · WinForms 4.0 in the GAC ·
      `wscript.exe` present). Message loop, death behaviour (ghost-until-hover) and elevation
      (tray never elevates; only the applier's task does) covered per candidate.
- [x] Verdict: **PowerShell 5.1 + `System.Windows.Forms.NotifyIcon`**, started hidden via a
      `wscript` wrapper by the logon task; `TaskbarCreated` re-add comes from the framework.
      Reserve: koffi → `Shell_NotifyIcon`. Fallback stands: **ship phase 3 without the tray**.
      The fork to the owner is NOT raised — a GUI-free path exists.

**Verification:** the recon doc exists, decision + fallback named; no code yet.

### 4.2 — Profile artifacts: four modes, a `qualified` gate, the R6 stamp ✅ 2026-08-14 01:0x

*Anchor: `plans/01_EPIC` §9 Б2; `MASTER_PLAN.md` → «Четыре режима»; AC7.*

- [x] Format extended (`profile-store.mjs`): `mode` (four ids; unknown → refused; stock-default
      that sets anything → refused), `qualified: true|false` required iff the profile sets state OR
      is a working mode, FORBIDDEN on factory-by-construction (same class as the stamp exemption).
      Draft numbers live in a `draft` documentation block (allowed only with `qualified: false`) —
      NOT in settings: the curve is not appliable until phase 6, and a settings key the applier
      ignores would be a profile that lies. Four mode files + factory shipped; the all-null
      working-mode draft explicitly does NOT fall through to the factory path (its own block).
- [x] `profiles/test-pl250.json` — `-pl 250`, `qualified: true` (both sides proven live in phase 2),
      titled «НЕ режим», evidence names why this is the one measured reversible curve-free write.
- [x] The applier gate sits in `apply()` (R1 — one gate for every calling surface), refuses BEFORE
      the first write, names the reason and «фаза 6». Stale stamps already refused (P2-AC5 = AC7).
- [x] Selftests: format 25 blocks, applier 17 — green; **five mutations, each reddening exactly its
      own blocks** (unknown-mode · stock-default-sets · qualified-type · qualified-on-factory ·
      gate-removed).

**Verification (taken):** offline green as above · live 2026-08-14 01:0x: `npm run profiles` → 6
profiles, 0 refusals, drafts labeled 📝 · `--apply optimised` refused with ZERO writes (power.limit
300 W before and after, exit 1) · `--roundtrip test-pl250` converged: 300 → 250 W read back → reset
300 W, compared fields equal. P3-AC1's mechanism: 2/2 (refuse-with-nothing-written · applied-and-
reread-matching). Card left stock.

### 4.3 — Four shortcuts, applying through the elevated task ✅ 2026-08-14 09:2x

*Anchor: `plans/01_EPIC` §9 Б3; internal map §4 (four shortcuts, the owner's names verbatim);
`researches/03` §3.6 (elevation without UAC prompts).*

- [x] `desktop-shortcuts.mjs`: `.lnk` via `WScript.Shell` (PowerShell COM one-shots, argv only —
      no shell in between). **Measured quirk:** WScript.Shell is ANSI — an emoji path fails with
      «??»; cured structurally (author under an ASCII temp name, rename with Node; read via a temp
      copy). Selftest: 5 blocks in a tmpdir sandbox, Desktop untouched, emoji round-trip proven.
- [x] `setup-desktop.mjs`: 5 pre-registered elevated tasks (`\KAGO\apply-<name>`, fixed args,
      Interactive, RunLevel Highest, no stored credentials — `researches/03` §3.6), 4 shortcuts
      (owner's names verbatim), receipt written BEFORE creation with per-artifact delete commands;
      `--uninstall` executes the receipt; `--status` read-only (run live: 0 of 5 present).
- [x] **Live install run 2026-08-14 09:2x** (the owner granted `npm run setup*` rights after the
      01:2x block): 5 tasks + 4 shortcuts created, receipt written BEFORE creation, all re-read.
      The proofs went through the TASK PATH — the same path the owner's clicks take:
      `schtasks /run apply-test-pl250` → power.limit read back **250.00 W** twice · `apply-factory`
      FROM that non-factory state → **300.00 W** twice (**P3-AC5**) · `apply-optimised` (draft) →
      task Last Result **1**, `gpu-info --json` before/after diff: zero settable changes (only
      volatile clock/pstate moved). Card left factory.

**Verification (taken):** P3-AC1 mechanism 2/2 via the task path · P3-AC5 taken · P3-AC3 on the
task path (exit 1, zero writes) · the created-artifacts receipt on disk with per-artifact deletes.

### 4.4 — Remembered state and the logon re-apply 🟡 mechanism proven 2026-08-14 09:4x; P3-AC2 series collecting

*Anchor: `plans/01_EPIC` §9 Б4; epic AC2; `MASTER_PLAN.md` phase 3 «запись запомненного состояния и
его восстановление задачей при старте ПК».*

- [x] The remembered state (`lib/remembered-state.mjs`, `runs/shell/remembered-state.json`: profile
      id + title + stamp + written-at), written by the applier's CLI on every successful apply —
      reset included. Deliberately NOT inside the library `apply()`: measurement tools (engine,
      vfstep, descend) drive profiles through the library and must never move the boot state.
- [x] `\KAGO\boot-apply` — logon-trigger task (read back as `MSFT_TaskLogonTrigger`, RunLevel
      Highest) running `--boot-apply` through the SAME applier gates. Verdict vocabulary is
      exhaustive and journaled: applied · factory-by-physics · factory-restored ·
      degraded-to-factory (draft/stale → zero writes, factory stands) · no-remembered-state ·
      remembered-unreadable · driver-gave-up · apply-failed-rolled-back.
- [x] Driver-not-ready: bounded retry (`config.BOOT_PROBE_RETRIES` 6 × 5 s), then a loud give-up
      into the journal with zero writes. The retry sits BEFORE the CLI's unconditional card probe —
      the branch order in `main()` is load-bearing.
- [x] Boot journal `runs/shell/boot-apply.jsonl` — one appended record per run (append
      mutation-proved: overwrite reddens the two-lines block).
- [ ] **P3-AC2 series: 5 natural logons, collecting itself in the journal.** No reboot is forced;
      close on the fifth verified record.

**Verification (taken 2026-08-14 09:4x, task path):** apply-test-pl250 → remembered=«test-pl250»,
card 250 W · card returned to factory + state restored (simulated post-logon), `schtasks /run
\KAGO\boot-apply` → 250.00 W twice, Last Result 0, journal `applied` · remembered=factory run →
`factory-by-physics`, zero writes, 300.00 W. Offline: 10 boot blocks in the applier selftest
(27 total), 3 mutations each reddening exactly their named blocks. Card left factory.

### 4.5 — The passive tray ✅ 2026-08-14 11:1x

*Anchor: `plans/01_EPIC` §9 Б5; internal map §4 — «displays the active profile and nothing else».*

- [x] Implemented per §4.1's verdict: `tray.ps1` (PowerShell 5.1 + `NotifyIcon`, UTF-8 **with BOM**
      — PS 5.1 reads BOM-less files as cp1251; the BOM is guarded by selftest block 1 and its loss
      is a loud parse failure, proven by mutation) + `tray-launcher.js` (wscript `//B //E:JScript`,
      hidden powershell — PowerShell#3028). Reads the remembered-state file on a 2 s mtime timer;
      polls nothing on the card. **Boundary named:** the tray shows the ORCHESTRATOR's state (last
      verified apply), not live telemetry — a truth↔mirror pair with the state file, refreshed on
      file change, and that is the whole contract. 7 faces (4 modes + test profile + unknown +
      problem), tooltip = the owner's title from the file, truncated below NotifyIcon's 63-unit
      ceiling. Selftest: 9 blocks in a tmpdir sandbox, no GPU; 3 mutations each reddening exactly
      their named blocks (truncation → block 7 · problem-face swap → blocks 4+5 · BOM strip →
      parse failure exit 1, louder than a red block).
- [x] Kill-safety proven live (**P3-AC4**): `gpu:info --json` before/after `Stop-Process` —
      **29 fields, the only diff `clocks.current.graphics` 975 → 922 MHz** (the idle clock
      breathing, volatile, not settable). Zero settable changes. Single instance proven: a second
      start exits on the `KAGO.Tray` mutex, pid file untouched.
- [x] Started at logon by its OWN task `\KAGO\tray` — **deliberately NOT the boot-apply task**
      (deviation from this plan's draft wording, recorded in §8): researches/07 §2 forbids an
      elevated tray, boot-apply runs Highest, and an elevated parent cannot cleanly spawn a
      de-elevated child. RunLevel **Limited**, logon trigger, NO execution time limit (the default
      5-minute cap would kill a tray that lives the whole session), in the receipt with its delete
      command BEFORE creation. Its absence degrades display only. Live mode-change track through
      the task path: apply-test-pl250 → card 250.00 W twice, log `state -> test-pl250` within one
      tick · apply-factory → 300.00 W twice, `state -> factory`. Card left factory.

**Verification (taken):** P3-AC4 diff = 0 settable · the tray log tracks a task-driven mode change
both ways · mutex · selftest 9/9 + 3 mutations. **Deferred, named:** the explorer-restart re-add
(`taskkill /f /im explorer.exe; start explorer` — disruptive on the owner's live desktop; the
re-add is the framework's own `TaskbarCreated` handler, read in the dotnet/winforms source) and
the no-console-flash-at-logon check (visible only at a real logon; the wrapper is the documented
cure). Both are display-only risks — neither can touch the card.

### 4.6 — Phase closure 🔲

- [ ] `/fable-judge` over everything this plan claims closed (mandatory before «done»).
- [ ] `MASTER_PLAN.md` phase 3 → closed with date + evidence; `STATUS.md` rewritten (debt line
      retired); internal map §4 updated from «design» to «built»; epic §9 track Б marked.
- [ ] «Decisions made without the owner» (§8) filled — every solo call listed, PENDING lines settled.

## 5. Boundaries — what phase 3 does NOT do

- **It does not qualify a single working mode.** Margin, long burns, the game witness — phase 5;
  numbers into profiles — phase 6. Here the three mode shortcuts exist and refuse honestly.
- **It does not put a curve write on the boot path** until a qualified profile exists — and even
  then through the same applier gates. In this phase the boot path can apply Stock Default and the
  test profile only.
- **The tray displays; it never controls.** No menu, no buttons, no click actions (owner's design,
  internal map §4).
- **Nothing outside the repo is created without a named rollback in the same receipt** — Desktop
  `.lnk`, scheduler tasks: the owner's-machine rule walks its five steps for each.

## 6. Risks by tier

**(a) Highest — defence built, not named:**

| Risk | Defence |
|---|---|
| The boot path or a desktop click applies an unproven undervolt | The `qualified` + stamp gates live INSIDE the one applier (R1), refusal mutation-proved (P3-AC3/AC7); volatile-state physics as the backstop — factory on any power cycle |
| Shell artifacts litter the owner's machine (Desktop, Task Scheduler) with no way back | Every created artifact listed in one receipt with its delete command BEFORE creation; smallest form; the suite never touches the real Desktop |
| The elevated task becomes a privilege surface | The task runs only our applier with fixed arguments; no shell, no parameter pass-through from the `.lnk` beyond the mode id |

**(b) Plausible — contingency named:**

| Risk | Contingency |
|---|---|
| No third-party-GUI-free tray path survives recon | Ship without the tray (display-only loss, owner's «будет хорошо» wording); fork to the owner only then |
| Logon task races driver initialization | Bounded retry then loud give-up; factory state stands by physics |
| `.lnk`/COM quirks under the agent's admin shell vs the owner's session | Test the click path as the OWNER runs it (`explorer.exe <lnk>` — the STATUS rule for launching owner apps), not only from the elevated shell |

**(c) Least likely — recorded:** tray API or scheduler policy changes on a Windows update (already
epic §6в) · the owner renames modes later (names ship verbatim; a rename is his word + `git mv`).

## 7. Verification map

| Step | The observation that closes it |
|---|---|
| 4.1 | `researches/07` exists; decision + fallback named |
| 4.2 | profiles selftest green incl. hostile fixtures; live refusals leave the card byte-identical |
| 4.3 | apply test profile → read-back match; reset from non-factory → factory match; receipt present |
| 4.4 | manual task run end-to-end; then 5 natural logons journaled, all verified states |
| 4.5 | ✅ taken 2026-08-14 11:1x: kill diff = 0 settable (29 fields, only the idle clock moved); tray.log tracked test-pl250 ↔ factory both ways |
| 4.6 | `/fable-judge` verdict; canon updated; §8 filled |

## 8. Decisions made without the owner

*(filled at closing; calls already made in writing this plan)*

- **Draft modes refuse instead of applying candidate numbers.** An unqualified undervolt reachable
  from a desktop shortcut violates the epic's *Avoid* goal; honesty over reachability.
- **The mechanism is proven with `-pl 250` as the test write** — the only measured, reversible,
  curve-free state change this project has (`researches/01`); it is labelled a test, not a mode.
- **The tray shows orchestrator state, not card telemetry** — display-only truth↔mirror with the
  state file; live telemetry on the tray would be a second instrument nobody asked for.
- **Shortcuts route through a pre-registered elevated task** (`researches/03` §3.6) — the recorded
  no-UAC path, and it removes the free-command surface a direct elevated `.lnk` would carry.
- **The owner's mode names and emoji ship verbatim** — identity is his; the agent never renames.
- **§4.5: the tray got its OWN unelevated logon task instead of riding boot-apply.** The plan's
  draft said «started by the same logon task after the re-apply»; researches/07 §2 (written later
  the same night) says the tray must never hold elevation, and boot-apply runs RunLevel Highest.
  An elevated parent cannot cleanly spawn a de-elevated child on Windows; a second task with
  RunLevel Limited is the smallest honest form. The recon outranks the plan's guess — both are
  agent artifacts, and the researched one is the observed one.
- **§4.5: tray.ps1 is UTF-8 WITH BOM, and the BOM is guarded.** PS 5.1 reads BOM-less files as
  ANSI (cp1251), which would mojibake the Russian tooltips. The dossier's «no BOM» rule is for
  JSON that Node parses; a .ps1 is read only by PowerShell, which wants the BOM. Selftest block 1
  reddens on its loss; the mutation proved the loss is loud (a parse failure, exit 1).
- **§4.5: the tray keeps its own tiny log (`runs/shell/tray.log`, capped at 512 KB)** — the only
  way a headless session can OBSERVE an icon change without eyes; the live acceptance read it.
