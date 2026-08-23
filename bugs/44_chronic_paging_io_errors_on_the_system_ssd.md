# Bug 44 — chronic paging I/O errors on the system SSD, and they are NOT ours

**Status:** 🔬 RESEARCH-ONLY — measured, cause unknown, deliberately not acted on
**Version/build:** found on `main` @ `242ad1a` · **When/context:** 2026-08-23 21:1x, while measuring
whether the sweep's hangs are hurting the owner's disks (`researches/17`)

## Symptom

```
disk id 51 «An error was detected on device \Device\Harddisk3\DR3 during a paging operation»
   35 events across 23 distinct days, 2026-07-01 … 2026-08-23
```

`Harddisk3` = disk 3 = **KINGSTON SA2000M8500G, NVMe, 466 GB — the system and boot drive, C:**.

## Why this is filed as NOT ours, and why that matters

The daily distribution is the whole argument:

```
07-01 x2 · 07-02 x2 · 07-03 x1 · 07-04 x5 · 07-05 x1 · 07-12 x1 · 07-13 x1 · 07-16 x1 · 07-20 x1
07-29 x1 · 08-04 x2 · 08-05 x3 · 08-06 x1 · 08-11 x1 · 08-14 x1 · 08-15 x1 · 08-16 x1 · 08-17 x1
08-18 x1 · 08-19 x1 · 08-21 x1 · 08-22 x2 · 08-23 x3
```

**Twelve of those twenty-three days carry no crash at all** (07-02, 07-03, 07-04, 07-12, 07-13,
07-16, 07-20, 08-04, 08-17, 08-18, 08-19, 08-21). The rate is a steady 1–5 per day and it starts
before epic 02's sweeps existed.

Filing it separately is the point, and it cuts both ways: attributing it to the edge hunt would
**overstate** our damage AND **hide** a real condition of the system drive behind our activity. The
neighbouring agent who raised the disk concern read the driver/disk error picture as one thing; it is
two, with opposite owners (`researches/17` §3).

## Forensics

| | |
|---|---|
| device | KINGSTON SA2000M8500G · NVMe · 466 GB · disk 3 · **IsBoot + IsSystem** |
| reported health | `Healthy` / `OK` |
| power-on hours | **not reported** by `Get-StorageReliabilityCounter` |
| wear | reported `0` — almost certainly «not reported» rather than pristine |
| read/write error counters | **not reported** |
| pagefile | **not on this disk** — `pagefile.sys` (21 504 МБ) lives on D: (NE-1TB, NVMe) |

**The instrument is blind here, and that is itself a finding.** Both NVMe drives return no hours and
no error counts through Windows' storage counters. A real figure needs SMART via `smartctl` or the
vendor tool, neither installed. **No number is invented to fill the gap** (`PHILOSOPHY.md` → the
three doors).

⚠️ **A paging operation is not only the pagefile.** Windows pages executables and memory-mapped files
from wherever they live, so id 51 on the boot drive is expected to involve C: even though the
pagefile sits on D:. That removes the obvious «the pagefile disk is failing» theory before anyone
builds on it.

## Hypotheses, ranked, none acted on

1. **Drive or controller degradation** — a 466 GB NVMe of unknown age under a system workload. Would
   be confirmed by SMART media/error-log counters, which we cannot currently read.
2. **Driver or firmware interaction** — id 51 is a *warning*, meaning the I/O was retried and the
   system continued. A storage driver quirk produces exactly this shape.
3. **Thermal** — the drive reports 49 °C, the highest of the three NVMe-class readings after D:'s
   53 °C. Plausible contributor, not a cause on its own.

**No fix is attempted from this document.** The honest next step is one read-only measurement
(install `smartctl` or read the vendor tool). Installing software falls in the destructive class on
this machine, so that step waits for an explicit instruction — it is not requested here, because a
request to the owner belongs in `interviews/` and nowhere else.

## What this bug is NOT

- Not a blocker for the sweep. Nothing here says a run is unsafe; the condition predates the epic and
  continues on quiet days.
- Not `bugs/43`. That one is a single-day filesystem burst on J: correlated with our crashes. Keeping
  them apart is deliberate.

## Decisions made without the owner

- **Filed as `🔬 research-only` rather than `🔴 open`.** The `AGENT_GUIDE` rule «a defect on the
  owner's machine preempts the current task» is about defects we can act on; here the next action is
  a software install, which is his call. Filing it keeps it visible without claiming a task.
- **No SMART tool installed.** Reading the drive properly would settle hypothesis 1 in a minute, and
  it is still an install on his machine.

## Links

`researches/17` §3 (the measurement and the ours/chronic split) · `bugs/43` (the one that IS ours)
