# Bug 43 — our hangs damaged the filesystem on J:, and it happened in a single day

**Status:** 🔴 OPEN — measured, not yet assessed for residual damage; the prevention is `plans/30`
**Version/build:** `main` @ `242ad1a` · **When/context:** found 2026-08-23 21:1x by read-only probes
while answering the owner's question about disk safety, relayed from a neighbouring agent

## Symptom

```
Ntfs id 55 «A corruption was discovered in the file system structure on volume J:»
   2026-08-22   x4996        ← ALL of them, on one calendar day
```

No other day since 2026-07-01 carries a single id-55 event. That same day carries **three unclean
shutdowns** (`Kernel-Power` 41 at 17:01, 17:25, 22:15).

`J:` is disk 0 (AS-1TB, SATA, 954 GB) and it is **the FTP service's target volume** — i.e. the one
volume on this machine with an unattended writer pointed at it.

## Why this is filed as OURS

The correlation is a single day, not a trend, and that day is a day the sweep killed the machine three
times. Every other day in the eight-week window has zero id-55 events, including days with heavy
normal use.

**What is NOT claimed** (and the distinction is the reason `researches/17` exists): that the sweep
caused all three of that day's crashes, and that the volume still carries damage today. The first is
likely but not provable from the log alone. The second is unmeasured — see the repro step below.

## Forensics

| | |
|---|---|
| volume | J: · NTFS · 954 GB · disk 0 · AS-1TB · SATA |
| dirty bit today | **NOT Dirty** — NTFS self-healed, the volume is consistent as far as Windows is concerned |
| drive health | `Healthy` / `OK`; power-on 11 927 h; read errors 0 / 0 |
| unclean shutdowns that day | 3 (17:01 · 17:25 · 22:15) |
| unclean shutdowns in the window | 12 since 2026-07-01, **5 of them on 22–23 August** |

Full measurement with every probe command: `researches/17`.

## Root cause

A hang hard enough to need the reset button kills the machine with writes in flight. NTFS's own
self-healing then repairs the structures it finds broken and logs one event per repair — hence the
volume of records. The exposure is highest exactly where an unattended writer keeps the volume busy,
which on this machine is the FTP service on J:.

**This is not a defect in KAGO's code.** It is the *storage-side price* of a risk the owner accepted
for the CARD (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК») and that nobody ever priced for storage.
That is what makes it a bug worth a document: an accepted risk with an unexamined second face.

## Fix plan

1. **Measure the residual damage first — read-only.** `chkdsk J: /scan` (the online, non-destructive
   scan; it does NOT dismount and does NOT repair). If it reports outstanding corruption, that is a
   separate finding and the owner decides about a repair pass, because a repair takes the volume.
2. **Prevent the recurrence** — `plans/30`: silence the writers that can be silenced before the sweep
   arms anything, with a receipt written first and a gate that refuses to run half-protected.
3. **Reduce the cause, which matters more than either** — fewer hangs. `bugs/42_DONE` closed the two
   defects that made yesterday's run burn rungs for nothing; `researches/16` + `plans/31` attack the
   blindness that makes an edge cost a reboot instead of a verdict.

**Explicitly NOT in this bug:** the chronic paging errors on C:. They are older, spread across the
whole period, and independent of our activity — `bugs/44`.

## Guard

The class here cannot be guarded by a test in this repository — the evidence lives in the Windows
System log, not in our code. The mechanical half is `plans/30` AC4: **the sweep refuses to write to
the card while the protections are only half-applied.** That converts «remember to protect the disks»
into a machine-checkable precondition, which is the same remedy the project applied to the watch
window (`bugs/17`, `bugs/39`, `bugs/42`).

## Decisions made without the owner

- **Filed as a bug rather than folded into `plans/30`.** A defect that already happened and a plan to
  prevent it are different objects: the plan can be rescheduled, the damage cannot be un-had, and a
  future session must be able to find «a filesystem was hurt on 2026-08-22» without reading a plan.
- **`chkdsk /scan` is NOT run as part of filing this.** It is read-only and safe, but it is an action
  on the owner's machine and it belongs in the fix's step 1 with him aware, not in a drive-by probe.

## Links

`researches/17` (the measurement) · `plans/30` (the prevention) · `bugs/44` (the chronic condition
this one is deliberately kept apart from) · `GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»
