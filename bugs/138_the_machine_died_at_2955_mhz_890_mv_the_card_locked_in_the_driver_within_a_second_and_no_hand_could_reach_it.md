# Bug 138 — the machine died at 2955 MHz / 890 mV: the card locked inside the driver within a second, and no rescue hand could reach it

**Status:** 🔴 OPEN — forensics done, no fix started · **Severity: S1** (the owner's machine hung; his
count, 2026-09-13: *«комп завис. Ракета упала на город. Ты убил ещё 1000 человек»*) ·
**Filed:** 2026-09-13 21:3x +03:00 (session 98) · **Found by:** the live re-burn of `plans/90`,
`--sweep --from 3067 --to 2377 --dashboard --log reburn-42`, owner at the machine
**Machine death count (Windows `Kernel-Power 41` since 2026-08-09): 19 — this is the nineteenth.**

---

## Symptom

The sweep started 21:08:20. At 21:09:39 it wrote the rung **2955 MHz @ 890 mV** (−210 mV from stock,
seq 965, shape raise-and-cap). The rung before it, **895 mV, PASSED** (seq 964, delivered 2947 MHz).
The machine froze; the owner reset it at ≈21:14 (OS start 21:14:00). seq 965 has an intent and no
verdict.

## Forensics — the timeline, from files, not from memory

Sources: `runs/death-watch/2026-09-13T18-08-24-081Z-fuse*.jsonl` (judge journal · ring · live-a/b ·
alive), `…-write.jsonl`, `runs/sweep/journal.jsonl`, `runs/reburn-42-stdout.log`, Windows System log.
Clock: judge files are UTC; +03:00 local below.

| local time | what | evidence |
|---|---|---|
| 21:09:40.81 | curve write for 890 mV complete, every `writeVfOffset` returned ok | `write.jsonl` seq 1396–1397 |
| 21:09:42.5 | burn load on: 264 W, power ratio 1 | ring |
| **21:09:43.49** | **last progress beat of the burn** | ring: `progressSilenceMs` < 5 |
| **21:09:43.53** | **power reading FREEZES at 265 335 mW and never changes again** for 74 s — the driver stopped answering the power read | ring: identical value on every record until 21:10:58.778 |
| 21:09:44.75 | **trip, cause `progress-stall`**, progress silence 1177 ms, beats alive (1.09 ms) | `fuse.jsonl` intent |
| 21:09:44.67 → 21:10:58.7 | **the judge records NOTHING for 74 s** | ring/live: 0 records with `t` in 80 600…154 600 |
| 21:10:34.9 … 21:10:54.7 | nvlddmkm **153 ×6 and 14 ×1** (driver errors); **no Display 4101** — no recovery | System log |
| 21:10:58.73 | hand 1 `kill-burn` returns: **ok=false, 73 974 ms**; `furnace.exe: убит`, `branchy.exe`/`sdc_fma.exe: status null` | `fuse.jsonl` outcome |
| 21:10:58.74 | hand 2 `stock-voltage` spawned (pid 44988), 8 ms | `fuse.jsonl` outcome |
| 21:10:58.78 | power reading unfreezes and reads **0 mW** | ring |
| 21:11:04.06 | re-arm refused: «КАРТА ОТВЕЧАЕТ, НО НЕ СЧИТАЕТ: пульс свежий, мощность 0 мВт 5.2 с — рука 2 расписки не напишет»; no `stock-voltage-verified` receipt ever | `fuse.jsonl` rearm |
| 21:13:35 | last write of the driver-voice liveness file — the OS was alive ≈4 min after the lock | `driver-alive.jsonl` mtime |
| 21:14:00 | OS restart; `Kernel-Power 41` at 21:14:14; boot-apply `factory-by-physics`, disks disarmed at logon | System log · `boot-apply.jsonl` |

## Root cause — what is established and what is not

**Established:**
1. **The card locked inside the driver within ≈40 ms of the last progress beat** (progress stops at
   43.49, the NVML power read freezes at 43.53). This is the «card answers, does not compute» class
   of 2026-09-08, not a slow degradation.
2. **Detection worked:** input 2 tripped 1.2 s after the lock.
3. **No in-machine rescue reached the card:** hand 1 blocked 74 s inside `taskkill` (the burn's thread
   sat in the wedged driver); hand 2 ran only after it and never produced a verified receipt; the
   driver's OWN recovery (seven error events, no 4101) failed as well.
4. **A separate, real defect of the fuse:** `makeImageKillHand` runs `spawnSync('taskkill', …)`
   synchronously inside the judge's loop — the judge was blind and deaf for the whole 74 s. The
   `timeout: 5000` per image did not bound the hand (three images → ≤ 15 s expected, 74 s measured).
   `decideRescue`'s written premise «hand 1 needs no driver and cannot hang» is REFUTED by this run
   (the same class as `bugs/91`, 6.7 s on 2026-08-31, never fixed).

**Not established, and it matters for any fix:**
- whether hand 2 would have completed if spawned at 21:09:44.75 instead of 21:10:58 — the driver was
  already not answering the power read, so an NVAPI write into it most likely blocks too. **The
  agent's own proposal of the same evening («the voltage hand must not wait for the load hand») would
  most likely NOT have saved this machine** — said to the owner in chat before any code.
- why the driver's resets failed; whether a forced adapter reset from outside the wedged context
  would succeed (not researched).

## Why the fuse did not save, and why the oracle did not warn (S4 duty)

- **Fuse:** detected in 1.2 s; could not act — both hands depend on the process/driver path that was
  already locked; hand 1 additionally blocked the judge.
- **Oracle:** the 895 mV rung passed its burn cleanly; nothing in the recorded channels distinguished
  the next 5 mV step before it killed the card (the same finding as epic 51 phase 6c: no separating
  quantity in the archive).

## Consequence for the method (the owner's decision, asked in chat 2026-09-13)

At this depth on this card the edge shows itself as an instant driver lock, which in-machine
protection cannot undo. Burning each frequency TO failure therefore risks a reboot per edge. The
proposal put to the owner: take this edge (2955 MHz: 895 passes, 890 kills → working point 900 mV),
DERIVE the other frequencies from known edges with a margin (the owner's permission of 2026-08-24),
and burn only where nothing can be derived, each such spot priced as a probable reboot.

## Fix plan — NOT started, waits for the owner's answer on the method

1. Hand 1 off the judge's thread (spawn, do not wait; bound by process lifetime) — the blind-judge
   defect, independent of the method decision. Guard: a block where a stuck kill no longer stops the
   judge's records.
2. Correct `decideRescue`'s premise in its comment and in `researches/`; re-open the hands' order
   only with recon (forced adapter reset as a possible third hand is an engineering fork → M4 recon).
3. On the next launch the journal closes seq 965 as `ЗАВИС` (R18 floor at 890 mV for 2955 MHz) —
   verify it lands exactly there and nowhere else (`hangFloors`, pure reader; never `resumeState`
   while a writer is up).

## Decisions made without the owner

- The live run was not resumed after the reboot; no write to the card since.

## Links

`bugs/91` (hand 1 slow, same class) · `bugs/132` (all inputs blind, 09.09) · `bugs/122` (card answers,
does not compute) · `plans/90` (the re-burn) · STATUS session 96 (hands are the bottleneck) ·
`GPU_TUNING_RAILS.md` S4
