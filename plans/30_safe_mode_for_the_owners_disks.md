# Plan 30 — safe mode for the owner's disks during an edge hunt

> **Created:** 2026-08-23 21:2x +03:00 · **Parent:** `researches/17` (measured evidence) · the owner's
> instruction 2026-08-23 21:2x («планируй отдельными документами. Ты будешь делать») after a
> neighbouring agent proposed the two protection levels · **Status:** 🔲 PLANNED, NOT STARTED ·
> **Outbound:** the gate lands in the sweep's start-up rail (`engine.mjs`, beside the watch-window
> gate); the level-2 decision goes to the owner as one named option, never as a silent default

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

## 🔴 §1. THE ONE DECISION THAT IS THE OWNER'S, CARRIED HERE INSTEAD OF DECIDED

**Level 1** (stop the FTP service · pause/close the torrent client · flush volume caches) is the
agent's to implement: reversible, cheap, and aimed exactly at the volume that was damaged.

**Level 2** (`Set-Disk -IsOffline $true` on disks 0/1/2 = J:, F:, E:) is **not**, and the reason is a
footgun the proposing agent named himself:

> **the offline flag survives a reboot.** After a hang the machine comes back with three volumes
> missing — at precisely the moment the owner is rebooting out of a black screen and is not thinking
> about disk flags.

| | Level 1 | Level 2 |
|---|---|---|
| what it removes | writes in flight from FTP and the torrent client | **every** write Windows could make to J:, F:, E: |
| what it cannot touch | C: (system, journals, registry) and D: (`pagefile.sys`) — they write always | the same two |
| cost if forgotten | a stopped FTP service; obvious, harmless | three volumes absent after boot; applications that expect `E:\Video` misbehave |
| reversibility | one command, no reboot | one command, but only if something remembers to run it |

**Recommendation to the owner: level 1 by default, level 2 available behind an explicit flag** and
only with AC7 satisfied. Rationale: level 2's marginal gain is real but small — the writers level 1
silences are the ones that were actually writing to J: — while its failure mode fires exactly when
the operator is least able to handle it.

**This section is the question's whole content, so it is self-sufficient** (`AGENT_GUIDE.md` → «A
QUESTION IS SELF-SUFFICIENT»). It does not need an interview: it is a bounded operational choice with
its cost priced, and the plan proceeds on level 1 while it waits.

## §2. Steps

### 2.1 Read the ground before touching it — **[NOT-TESTED]**
- [ ] Enumerate what currently holds handles on E:, F:, J: (`handle.exe` is absent; use
      `Get-SmbOpenFile` where applicable and the process roster otherwise). **Read-only.**
- [ ] Record the baseline: `ftpsvc` state, torrent client presence, per-volume dirty bits.
- [ ] Write the roster into the plan as a table. A tool that stops «what it thinks is there» is a
      tool that stops the wrong thing.

### 2.2 The receipt comes first — **[NOT-TESTED]**
- [ ] Extend the existing rollback-receipt convention (`runs/shell/rollback/`, already used for the
      logon-language and scheduler edits) with a `safe-mode` record: what was stopped, what was
      offlined, at what time, and the exact command that undoes each item.
- [ ] **The receipt is `fsync`ed before the first state change.** Same reasoning as R15 for the
      sweep's journal: a machine that dies takes the page cache with it, and a receipt that is
      durable only when nothing went wrong is durable exactly never when it matters.

### 2.3 `tools/safe-mode.mjs` — arm, disarm, status — **[NOT-TESTED]**
- [ ] `--status` first and it is read-only: prints every item and whether it is armed. **Written
      before `--on` exists**, so the tool can always describe the machine even if arming half-fails.
- [ ] `--on` — level 1: stop `ftpsvc`, pause the torrent client, `Write-VolumeCache` per lettered
      non-system volume. Each step records into the receipt BEFORE acting.
- [ ] `--on --offline-disks` — level 2, behind its own flag, refusing when a handle is still open.
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

## §3. Risks, tiered per `PHILOSOPHY.md` (Murphy)

| Tier | Risk | Contingency |
|---|---|---|
| **(a) highest** | The tool leaves the machine half-protected after a crash and nobody notices | AC4 + AC7: the sweep refuses, and `--status` reads it off the receipt |
| **(a) highest** | `--off` throws on item 1 and silently skips items 2…N | R10a: each duty in its own `try`, failures reported per item |
| (b) plausible | `Set-Disk -IsOffline` fails because a handle is open, leaving level 2 partly applied | refuse level 2 up front when handles are open; never force |
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
