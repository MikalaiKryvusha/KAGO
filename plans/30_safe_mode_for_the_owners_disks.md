# Plan 30 — safe mode for the owner's disks during an edge hunt

> **Created:** 2026-08-23 21:2x +03:00 · **Parent:** `researches/17` (measured evidence) · the owner's
> instruction 2026-08-23 21:2x («планируй отдельными документами. Ты будешь делать») after a
> neighbouring agent proposed the two protection levels · **Status:** 🔲 PLANNED, NOT STARTED ·
> **Outbound:** the gate lands in the sweep's start-up rail (`engine.mjs`, beside the watch-window
> gate); the disarm lands in the EXISTING `\KAGO\boot-apply` scheduled task
>
> 🟢 **§1 CLOSED 2026-08-23 22:3x by the owner (`interviews/013` Q3 = D).** Level 2 is **no longer
> `IsOffline`** — it is **`Set-Disk -IsReadOnly $true`**, and it is ON BY DEFAULT. The offline flag
> survives as an opt-in flag only. The swap is not an argument, it is a MEASUREMENT taken on disk 2
> (E:) while the owner's film was playing off it: reads and the film untouched (16,50 → 17,06 MB per
> 6 s window), writes refused by the storage layer («The media is write protected»), volume never
> dismounted, rollback clean. Level-2 protection at level-1 cost.

---

## Goal vector

**Pain.** Twelve unclean shutdowns since 2026-07-01, five of them in the last two days, and on
2026-08-22 a filesystem was actually damaged: **4996 NTFS corruption records on J: in one day**
(`researches/17` §2, `bugs/43`). Every one of those crashes is the owner's machine dying while
programs hold files open on five volumes. The edge hunt is going to continue producing hangs — the
owner accepted that risk for the CARD (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»), and nobody ever
accepted it for his STORAGE.

**Where we want to be (Achieve).** A hang during an edge hunt costs one reboot and nothing else,
because the writers that can be silenced were silenced before the first write to the card — and
because the silencing cannot be left half-applied by a machine that died.

**Type: Achieve + Avoid.** Achieve a repeatable pre-session state; avoid ever leaving the machine in
a half-protected state after a crash.

## Acceptance criteria

Written per `REQUIREMENTS_FRAMEWORK.md`; each carries Scale / Meter / Target.

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **AC1** | WHEN the safe mode is armed, the FTP service is stopped and the torrent client holds no handle on E: | services and handles · `Get-Service ftpsvc` + `Get-Process` roster · `ftpsvc` = Stopped, client absent or paused |
| **AC2** | WHEN the safe mode is armed, every non-system volume's write cache has been flushed | flush calls · the tool's own receipt · one `Write-VolumeCache` per lettered non-system volume, each returning success |
| **AC3** | The tool writes a rollback receipt **BEFORE** the first state change | file existence and order · the receipt's own timestamp vs the service's stop time · receipt strictly earlier |
| **AC4** | **IF any part of the safe mode is still armed, THEN `engine --sweep` REFUSES to write to the card** | exit code · `npm run engine -- --sweep --dry-run` and the live path on a machine with `ftpsvc` stopped · exit ≠ 0 and the reason names what is still armed |
| **AC5** | The refusal in AC4 is proved on a BROKEN version | mutation · remove the gate, re-run the block · the block reddens |
| **AC6** | Disarming restores every recorded item, and reports anything it could not restore | items restored / items in receipt · the tool's own summary · 100 %, or a named failure per item |
| **AC7** | The state survives a reboot honestly: after an unclean shutdown the machine can TELL that the safe mode is still armed | detectability · a fresh session runs the status command · it names every armed item without reading the agent's memory |
| **AC8** | Zero writes to the GPU across the whole plan | count · `npm run watchdog -- --status` + no `vfstep`/`profile` invocation · 0 |
| **AC9** | WHEN level 2 is armed, each of J:, F:, E: **refuses writes while still serving reads** | probe write + probe read per volume · the tool's own `--verify` · writes refused 3/3, reads succeed 3/3, all three letters still present |
| **AC10** | An unclean shutdown costs the owner NO disk action: the next logon disarms whatever was left armed | items left armed after logon · `--status` run in a fresh session after `\KAGO\boot-apply` fired · 0, or a named failure per item |

## 🟢 §1. THE OWNER'S DECISION — CLOSED 2026-08-23 22:3x

**Answered in `interviews/interview_013…` Q3: variant D**, a variant the question did not contain.
The owner's counter-question produced it: *«Если B - я смогу читать с диска. фильм смотреть, пока
диски оффлайн?»* The honest answer was **no** — offline dismounts the volumes, the letters vanish,
and on this machine that is where the films live (C: is the system, D: is Games, and J:/F:/E: are
the whole of the storage). But the question named the rung nobody had priced: **read-only**.

**Level 1** (stop the FTP service · pause/close the torrent client · flush volume caches) — unchanged,
by default.

**Level 2 is now `Set-Disk -IsReadOnly $true` on disks 0/1/2 (J:, F:, E:), BY DEFAULT.** The volume
stays mounted, the letter stays, reads work, writes are refused by the storage layer.

### The measurement that decided it — disk 2 (E:), 2026-08-23 22:29–22:31

Taken on the live machine **while the owner's film was playing off that very disk**, judged by the
player's own read counters (`PotPlayerMini64`, pid 30664) rather than by impression. Rollback receipt
written before the first state change (AC3).

| meter | no flag | **under `IsReadOnly`** | verdict |
|---|---|---|---|
| film reading from E:, 6 s window | 16,50 MB / 264 ops | **17,06 MB / 273 ops** | noticed nothing |
| open a NEW file on E: | — | **4096 bytes read** | reads live |
| write a file to E: | — | **`The media is write protected`** | writes refused |
| letter · volume · health | E: · Healthy · OK | **E: · Healthy · OK** | never dismounted |

The refusal comes from **below** NTFS and below permissions, so it silences every writer at once —
FTP and the torrent client included — without any of them knowing KAGO exists. Rollback was clean:
`IsReadOnly = False`, the probe write passed again, no trace left.

⚠️ **NOT measured, and not claimed:** whether `IsReadOnly` survives a reboot. The machine was not
rebooted mid-film. It does not change the design — the logon disarm (2.6) is required either way and
clears offline and read-only identically.

| | Level 1 | **Level 2 = read-only** | Level 2-offline (opt-in) |
|---|---|---|---|
| what it removes | writes in flight from FTP and the torrent client | **every** write to J:, F:, E: | the same |
| reading, films, search | untouched | **untouched — MEASURED** | impossible: no letters |
| what it cannot touch | C: and D: — they write always | the same two | the same two |
| cost if forgotten | a stopped FTP service; obvious, harmless | three volumes read-only; visible, files intact | three volumes ABSENT after boot |
| blocked by an open handle | no | **no — measured with a film open** | yes (risk (b) below) |

**`--offline-disks` survives as an explicit opt-in flag**, for when the owner deliberately wants
Windows not to touch the disks at all.

**Why this is safe to default now.** The footgun that kept level 2 out — *the flag survives a
reboot* — is defused twice over: the flag now leaves the disks present and readable rather than
missing, and the logon disarm (2.6) clears it without the owner doing anything.

## §2. Steps

### 2.1 Read the ground before touching it — **[NOT-TESTED]**
- [ ] Enumerate what currently holds handles on E:, F:, J: (`handle.exe` is absent; use
      `Get-SmbOpenFile` where applicable and the process roster otherwise). **Read-only.**
- [ ] Record the baseline: `ftpsvc` state, torrent client presence, per-volume dirty bits.
- [ ] Write the roster into the plan as a table. A tool that stops «what it thinks is there» is a
      tool that stops the wrong thing.

### 2.2 The receipt comes first — **[NOT-TESTED]**
- [ ] Extend the existing rollback-receipt convention (`runs/shell/rollback/`, already used for the
      logon-language and scheduler edits) with a `safe-mode` record: what was stopped, which disks
      were made read-only (or offlined), at what time, and the exact command that undoes each item.
- [ ] **The receipt lives on `C:`** — never on a volume this mode can arm (see 2.6).
- [ ] **The receipt is `fsync`ed before the first state change.** Same reasoning as R15 for the
      sweep's journal: a machine that dies takes the page cache with it, and a receipt that is
      durable only when nothing went wrong is durable exactly never when it matters.

### 2.3 `tools/safe-mode.mjs` — arm, disarm, status — **[NOT-TESTED]**
- [ ] `--status` first and it is read-only: prints every item and whether it is armed. **Written
      before `--on` exists**, so the tool can always describe the machine even if arming half-fails.
- [ ] `--on` — level 1: stop `ftpsvc`, pause the torrent client, `Write-VolumeCache` per lettered
      non-system volume. Each step records into the receipt BEFORE acting.
- [ ] `--on` — level 2 **by default**: `Set-Disk -IsReadOnly $true` on disks 0/1/2, AFTER the level-1
      flush, each disk recorded into the receipt BEFORE acting. An open handle does NOT block it
      (measured with the owner's film open) — but a FAILED disk is recorded as such and the
      remaining disks still get their turn (R10a applies to arming, not only to rollback).
- [ ] `--verify` proves AC9 by observation, not by assumption: one probe read and one probe write per
      volume, reporting per letter. A probe write that SUCCEEDS under an armed mode is a failure of
      the mode and must be reported as one, never swallowed.
- [ ] `--on --offline-disks` — the old level 2, now an explicit opt-in, refusing when a handle is
      still open. Never both: `--offline-disks` REPLACES the read-only rung, it does not stack.
- [ ] `--off` — restore by the receipt, item by item, **each in its own `try`** (R10a: a rollback with
      more than one duty is a LIST, never a chain — the first throw must not cancel the rest).
- [ ] Never touch a channel to the machine or someone else's work: Parsec, VPN, the IDE hosting the
      session, Docker with running containers — the standing rule from `AGENT_GUIDE.md`.
- [ ] `--selftest` on injected service/disk seams, offline, and it joins `selftest:all` **with the
      code, not later** (`TESTING_FRAMEWORK.md` → the work produces its own means of checking).

### 2.4 The gate in KAGO — the half that makes it machinery, not diligence — **[NOT-TESTED]**
- [ ] `engine --sweep` reads the safe-mode status at start-up and **refuses to write to the card while
      the mode is armed only in part** (AC4). Same shape and same place as the watch-window gate.
- [ ] The refusal NAMES what is still armed and the exact command that clears it.
- [ ] Mutation-prove it (AC5): remove the gate → the block reddens.
- [ ] ⚠️ **The gate must not become a second way to block a legitimate run.** It fires on
      *half*-armed, never on fully-armed or fully-disarmed — a guard that reddens on the normal
      operating state is the trap R12 · R13 · R17 all name, and this project has fallen into it twice.

### 2.5 Close the loop after a hang — **[NOT-TESTED]**
- [ ] After any unclean shutdown, `--status` must be able to say «the safe mode was left armed» from
      the receipt on disk alone (AC7) — no memory, no session, no agent.
- [ ] The sweep's own start-up prints that line before anything else when it is true.

### 2.6 The logon disarm — the owner's second question, answered in machinery — **[NOT-TESTED]**

The owner asked for disarm «at KAGO restart». Deliver it **at logon instead**, which is strictly
better: after a black screen he presses the button and looks at the desktop — he does not launch
KAGO. The mechanism already exists and already runs.

- [ ] Hang the disarm on the EXISTING `\KAGO\boot-apply` task — `RunLevel: Highest`, trigger
      `MSFT_TaskLogonTrigger`, already raising the card profile after every reboot (verified
      2026-08-23 by `Get-ScheduledTask -TaskPath '\KAGO\*'`). **No new autostart entry is created**;
      an elevated logon task is exactly the privilege `Set-Disk` needs, and the tray cannot supply it
      (`Limited`, deliberately, per `plans/10`).
- [ ] The receipt lives on **C:** — never on a disk the mode itself may have armed. A receipt stored
      on a read-only volume is a receipt that cannot record its own rollback.
- [ ] The disarm reads the receipt and restores item by item (AC6, AC10), each in its own `try`.
- [ ] It runs BEFORE the profile apply in the same task: the card work must not start on a machine
      that is still half-armed (AC4 would refuse it anyway; do not make the two gates race).
- [ ] Prove AC10 by observation: arm the mode, fire the task, run `--status` in a fresh session → 0
      armed. Then mutation-prove it: break the disarm → the block reddens.
- [ ] ⚠️ **Honest hole, named rather than papered over:** a machine that never reaches logon never
      disarms. That is why the receipt sits on C: and `--status` reads it with no agent and no
      memory (AC7). This hole belongs to EVERY variant, offline included — it is not a cost of D.

## §3. Risks, tiered per `PHILOSOPHY.md` (Murphy)

| Tier | Risk | Contingency |
|---|---|---|
| **(a) highest** | The tool leaves the machine half-protected after a crash and nobody notices | AC4 + AC7: the sweep refuses, and `--status` reads it off the receipt |
| **(a) highest** | `--off` throws on item 1 and silently skips items 2…N | R10a: each duty in its own `try`, failures reported per item |
| (b) plausible | `Set-Disk -IsOffline` fails because a handle is open, leaving level 2 partly applied | **no longer the default path** — read-only is not blocked by open handles (measured). Still applies to the `--offline-disks` opt-in: refuse it up front when handles are open; never force |
| (b) plausible | `IsReadOnly` behaves differently on J: or F: than it did on the measured E: | AC9 `--verify` probes EACH volume and reports per letter; a disk whose write probe passes is reported as unprotected, never assumed protected |
| (b) plausible | An app writing to J:/F:/E: at arming time gets a hard write error instead of a clean pause | that is the mode working as designed; level 1 pauses the two known writers FIRST, and the arming order (level 1 → flush → read-only) exists for exactly this |
| (c) listed | `IsReadOnly` survives the reboot and nobody notices | 2.6 disarms at logon without the owner acting; and unlike offline, the disks are present and readable meanwhile |
| (b) plausible | Stopping `ftpsvc` breaks something the owner was using | it is his machine and his call; the receipt makes it a one-command undo |
| (c) listed | `Write-VolumeCache` unavailable on some volume type | report and continue; the flush is a best-effort improvement, not a gate |

## §4. What this plan explicitly does NOT do

- **It does not reduce the number of hangs.** That is the actual lever on disk exposure, and it lives
  elsewhere: tonight's engine fixes (`bugs/42_DONE`) and the probability profile (`researches/16`,
  `plans/31`). This plan handles the CONSEQUENCE; those handle the CAUSE, and the cause matters more.
- **It does not protect C: and D:.** They hold the system, the journals, the registry and the
  pagefile; they write always. That residual is the price of hunting the edge on a live machine, and
  it is named rather than papered over.
- **It does not diagnose the chronic paging errors on C:** — `bugs/44`, separate owner, not ours.

## §5. Decisions made without the owner

*(filled at closing)*
