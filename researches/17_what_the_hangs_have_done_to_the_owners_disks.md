# Research 17 — what the hangs have actually done to the owner's disks, measured

> **Created:** 2026-08-23 21:2x +03:00 · **Parent:** the owner's chat 2026-08-23 21:1x, relaying a
> neighbouring agent's concern («переживает, чтобы мы не убили диски») · **Status:** 🟢 MEASURED —
> every number below came off this machine with read-only probes on 2026-08-23 21:1x…21:2x; nothing
> was changed. **Outbound:** the evidence base for `plans/30` (the safe mode) and `bugs/43` / `bugs/44`;
> the «ours vs chronic» split → `STATUS.md` → «Состояние машины, о котором надо знать»

---

## 0. Why this document exists before any protective code

A neighbouring agent raised the concern and proposed remedies. The remedies are sound in outline, but
they were proposed against an UNMEASURED picture — «hangs are bad for disks» is true in general and
says nothing about this machine. This project's own rule forbids acting on that
(`PHILOSOPHY.md` → observation instead of conjecture): before hardening anything, find out what has
already happened here, and separate **what our hangs did** from **what was already wrong**.

That split turned out to be the whole finding.

## 1. The machine's storage, as probed

| Disk | Model | Bus | Letter | Role | Health |
|---|---|---|---|---|---|
| 0 | AS-1TB | SATA | **J:** | FTP target | Healthy |
| 1 | Apacer AS350 1TB | SATA | **F:** | — | Healthy |
| 2 | SSD 1TB | SATA | **E:** | video (torrent client holds handles) | Healthy |
| 3 | KINGSTON SA2000M8500G | **NVMe** | **C:** | **system + boot** | Healthy |
| 4 | NE-1TB | **NVMe** | **D:** | **`pagefile.sys`, 21 504 МБ** | Healthy |

All five report `HealthStatus: Healthy` / `OperationalStatus: OK`. No volume carries a dirty bit
(`fsutil dirty query` on C: D: E: F: J: — all «NOT Dirty»).

**Probe:** `Get-PhysicalDisk` · `Get-Disk` + `Get-Partition` · `Get-CimInstance Win32_PageFileUsage` ·
`fsutil dirty query <L>:`

### Reliability counters — thin, and the thinness is itself a fact

| Disk | Power-on hours | Wear | °C | Read errors (total / uncorrected) |
|---|---|---|---|---|
| AS-1TB (J:) | 11 927 | 0 | 42 | 0 / 0 |
| Apacer AS350 (F:) | 10 380 | 0 | 33 | — not reported — |
| SSD 1TB (E:) | 13 882 | 0 | 40 | **2 / 2** |
| KINGSTON (C:) | — not reported — | 0 | 49 | — not reported — |
| NE-1TB (D:) | — not reported — | 0 | 53 | — not reported — |

**Two honest limits of this table.** The two NVMe drives — the system disk and the pagefile disk,
i.e. exactly the two that cannot be protected — report **no** power-on hours and **no** error counts
through `Get-StorageReliabilityCounter`. So the instrument is blind on the half that matters most.
And `Wear: 0` on drives with 10 000+ hours is almost certainly «not reported» rather than «pristine».
A real wear/unsafe-shutdown figure needs SMART through a vendor tool or `smartctl`, which is not
installed here. **Recorded as a gap, not filled with a guess.**

**Probe:** `Get-PhysicalDisk | Get-StorageReliabilityCounter`

## 2. 🔴 THE FINDING: one filesystem was damaged, and it happened in a single day

```
Ntfs id 55 «A corruption was discovered in the file system structure on volume J:»
   2026-08-22   x4996
```

**All 4996 events fall on one calendar day, and that day carries three unclean shutdowns**
(`Kernel-Power` 41 at 17:01, 17:25, 22:15). No other day since 2026-07-01 has a single id-55 event.

This is not a general risk any more. **A filesystem on this machine has already been hurt, and the
day it happened is a day we crashed the machine three times.** NTFS self-healed (the volume is not
dirty today), but five thousand repair records in twenty-four hours is not background noise.

Filed as `bugs/43`.

**What this document does NOT claim:** that the sweep caused all three of that day's crashes, or that
J: holds no residual damage. The first is likely but unproven from the log alone; the second needs a
read-only `chkdsk /scan`, which is step 1 of `bugs/43`.

**Probe:** `Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Ntfs'; Id=55; StartTime=<d>} | Group-Object {$_.TimeCreated.ToString('yyyy-MM-dd')}`

## 3. 🟡 AND THE SECOND FINDING IS THE OPPOSITE: the paging errors are NOT ours

```
disk id 51 «An error was detected on device \Device\Harddisk3\DR3 during a paging operation»
   07-01 x2 · 07-02 x2 · 07-03 x1 · 07-04 x5 · 07-05 x1 · 07-12 x1 · 07-13 x1 · 07-16 x1 · 07-20 x1
   07-29 x1 · 08-04 x2 · 08-05 x3 · 08-06 x1 · 08-11 x1 · 08-14 x1 · 08-15 x1 · 08-16 x1 · 08-17 x1
   08-18 x1 · 08-19 x1 · 08-21 x1 · 08-22 x2 · 08-23 x3      — 35 events, 23 distinct days
```

`Harddisk3` = **disk 3 = the KINGSTON = C:, the system and boot drive.**

**They are spread across the whole period, including days with no crash at all** (07-02, 07-03,
07-04, 07-12, 07-13, 07-16, 07-20, 08-04, 08-17, 08-18, 08-19, 08-21). The rate is 1–5 per day and it
predates the epic-02 sweeps. **Attributing them to the edge hunt would be wrong**, and it would also
hide a real condition of the system drive behind our own activity.

Filed as `bugs/44` — separate, and NOT blocking the sweep.

## 4. The crash ledger itself

```
Kernel-Power 41 — 12 unclean shutdowns since 2026-07-01
   07-29 13:00 · 08-05 22:14 · 08-06 20:35 · 08-11 06:24 · 08-14 21:16 · 08-15 09:59
   08-16 23:32 · 08-22 17:01 · 08-22 17:25 · 08-22 22:15 · 08-23 11:45 · 08-23 11:54
```

Twelve — the same twelve `researches/15` and `researches/16` reason about. **Five of them fall in the
last two days.** Whatever the disks' absolute risk per crash, the exposure is rising, and the cheapest
lever on it is not a disk tool: it is fewer hangs.

## 5. Noise deliberately excluded from the findings

| What | Count | Why it is not a finding |
|---|---|---|
| `disk` id 158 | 52 | «same disk identifiers» — two disks share a signature (a cloned drive). A configuration wart, not damage; no I/O is affected |
| `disk` id 153 | 2 | «IO operation … was retried» — a retry that SUCCEEDED, on disk 1. Two in eight weeks is within any drive's normal behaviour |
| `DistributedCOM` 10016 / 10010 / 10005 | 1010 | permission and registration noise Windows generates on every desktop; unrelated to storage |

Naming them here is the point: a future session grepping the System log will meet these first, and
without this table they read as «the machine is falling apart».

## 6. What the neighbouring agent got right, and the one thing measurement corrects

**Right, and now backed by a number:** the concern itself. J: is the FTP target, FTP writes to J:, and
J: is the volume that got hurt. His level-1 remedy (stop the writers, flush the caches before a
session) aims exactly where the damage landed. His disk→letter map is also correct — verified above,
0=J, 1=F, 2=E, 3=C, 4=D.

**Corrected by measurement:** he read the driver/disk error picture as one thing. It is two, with
opposite owners — a single crash-day burst on J: (ours) and a chronic 1–5/day paging fault on C:
(not ours, older than the epic). Treating them together would have hardened the wrong disk and left
a real system-drive condition unexamined.

**And one boundary he stated himself that survives scrutiny:** disabling volume write caching buys
little, because the exposure that matters is the SSD's internal translation table, which no Windows
setting reaches. Flushing before a run is a different action and does help — it empties what is in
flight. Both statements are compatible and both are kept.

## 7. What this evidence does and does not authorise

- **Authorises** the level-1 protections (stop the writers, flush) — cheap, reversible, aimed at the
  volume that was actually damaged. → `plans/30`.
- **Authorises** treating «offline the non-system disks» as a real option — but with its footgun named,
  because the offline flag survives the reboot that follows a hang. → `plans/30`, and it is an
  owner-level decision, not the agent's.
- **Does NOT authorise** any claim about wear or remaining life: the instrument does not report it on
  the two NVMe drives, and an invented figure is worse than a missing one.
- **Does NOT authorise** stopping the sweep. Nothing measured here says the next run is dangerous to
  storage beyond the price already accepted (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»).

## 8. Where the forks live

This document asks the owner nothing. Every call here was the agent's except the level-2 offline
choice, and that one is carried to him where such things belong — `interviews/013` Q3, quoted in full
with its cost, never as a line in a research tail.

*(The section is worded this way on purpose: the questions guard matches SECTION HEADINGS without
reading what is under them — class D of `bugs/40`, still open. A heading like «Open questions for the
owner» over the word «None» is a false hit that the guard's own report has already carried once, from
`researches/10` §5. Adding a second while the class is open would be filing a defect against myself.)*
