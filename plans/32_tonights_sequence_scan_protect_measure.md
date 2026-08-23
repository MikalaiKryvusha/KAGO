# Plan 32 — tonight's sequence: scan the damage, protect by hand, then measure on silicon

> **Created:** 2026-08-23 21:5x +03:00 · **Parent:** `researches/17` · `bugs/43` · `bugs/42_DONE`
> (the fixes this run exists to prove) · the owner's instruction 2026-08-23 21:5x («записывай в план,
> делаем в той последовательности, как ты предложил»)
> **Status:** 🔲 STEP 1 STARTING — four steps, executed in order, each gating the next
> **Outbound:** step 1's verdict → `bugs/43`; step 3's measurements → the curve document and
> `researches/16` case №13; step 4 → `plans/30`

---

## Goal vector

**Pain.** Three things are true at once and they pull against each other. A filesystem on this
machine was damaged eleven days' worth of crashes ago and **nobody has checked whether the damage is
gone** (`bugs/43`). Tonight's engine fixes are proved only against offline fixtures — the live sweep
path is still `[NOT-TESTED]` in its own header. And the owner has been waiting through an evening of
tool-building to see the card actually tuned.

**Where we want to be (Achieve).** By the end of the sequence: we know J:'s real condition from a
scan rather than an assumption; the writers that hurt it are silenced with a receipt; and a live run
has either confirmed the fixes on silicon or told us precisely what it found — with the card returned
to a state we can describe.

**Type: Achieve, and the ORDER is the content.** Each step exists to make the next one safe or
meaningful. Reordering them removes the point.

## Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **AC1** | J:'s current condition is known from a read-only scan, not inferred | verdict text · `chkdsk J: /scan` · a stated result, and the volume never dismounted |
| **AC2** | IF the scan reports outstanding corruption, THEN step 3 does not run until the owner decides | gate · the sequence itself · no GPU write before his word |
| **AC3** | The writers that touch J: are stopped, and the undo is on disk BEFORE they are | receipt timestamp vs service stop time · the receipt file · strictly earlier |
| **AC4** | Everything stopped in step 2 is running again at the end | services restored / services stopped · `Get-Service` · 100 % |
| **AC5** | The live run confirms the two `bugs/42` fixes on real silicon, or names what it met instead | observations · the run's own report and the journal · the descent orders no voltage twice; the watch window is gone when the run ends |
| **AC6** | The card ends the evening at a state we can describe in numbers | readings · `nvapi --curve` + `nvidia-smi` · offsets and power limit reported, watchdog not armed |

## §1. Step 1 — measure the damage, read-only

- [ ] `chkdsk J: /scan` — the ONLINE scan. It does **not** dismount, does **not** repair, and can run
      while the volume is in use. Report the verdict verbatim with its numbers.
- [ ] Write the result into `bugs/43` — a number either way, including «no problems found».
- [ ] **GATE (AC2):** outstanding corruption → stop the sequence here and hand the owner the choice.
      A repair pass takes the volume offline and is his call, not the agent's.

## §2. Step 2 — level-1 protection, applied by hand

The tool (`plans/30`) is NOT built first, and that is deliberate: it makes the protection repeatable
and un-forgettable for the long campaign, and tonight the protection itself takes a minute by hand.
**Building the tool before using the protection would be the evening's mistake repeated.**

- [ ] Record the baseline: `ftpsvc` state, torrent client presence.
- [ ] Write the rollback receipt into `runs/shell/rollback/` **before** the first change, naming the
      exact command that undoes each item.
- [ ] Stop `ftpsvc`. Pause or close the torrent client.
- [ ] `Write-VolumeCache` on the lettered non-system volumes.
- [ ] **Level 2 (disks offline) is NOT applied** — `interviews/013` Q3 is open, and the default the
      plan recommends is level 1 only.
- [ ] Restore at the end of the evening, by the receipt, each item in its own `try` (R10a).

## §3. Step 3 — the live run

### 3.1 The band, and it OVERRIDES the engine's own derivation for this one run

The engine, given no arguments, derives **2355…2310 MHz** — «continue downward from the tuned
region». The rule is right and stays. But the band it lands on tonight is the poorest remaining:

| | the derived band | the holes |
|---|---|---|
| frequencies | 2355…2310, 7 | **2775 · 2752 · 2700 · 2685 · 2647** (and 2565 · 2497 · 2452 · 2430 below) |
| lever reach there | 75–110 mV | **125–245 mV** |
| position | at the floor of the shippable form | mid-range, richest part of the curve |
| seed | one distant neighbour, 2797 MHz | **tuned neighbours on BOTH sides of every hole** |

The holes are untouched frequencies sitting INSIDE the already-tuned region. `autoBand` skips them on
purpose — a lone rung between two closed neighbours is a different risk, and absorbing them silently
would report progress that was not made. Taking them is therefore an EXPLICIT band, named on the
command line, which is exactly the path the owner asked to keep working alongside the automatic one.

- [ ] Dry run the chosen band FIRST and read it (rail S2). Exit non-zero → do not run.
- [ ] Show the owner the plan before the first write: band, rungs, first step depth, who holds the
      ceiling, and the rollback.
- [ ] `npm run watchdog -- --status` immediately before — nothing may be holding the card.

### 3.2 What this run is FOR, stated so the result is judged against it

Not the frequencies. **The two `bugs/42` fixes, on silicon:**

1. the descent never orders one voltage twice — the defect that burned yesterday's rungs for nothing;
2. the watch window dies with the run — the defect that left the owner hearing sound from another
   room and believing a dead run was alive.

Both are proved offline (293 blocks, mutations DM/BW red). Neither has met the card.

- [ ] Watch for `no-progress` / `rebase` events in the run's own output and record what they said.
- [ ] After the run ends — by any path, including Ctrl+C — verify with the owner's eyes that the
      window and its sound are GONE. **The agent has no sensor for his desktop**, so this one is
      reported as «сделал, посмотрите», never as «починил» (`AGENT_GUIDE.md`).

## §4. Step 4 — build `plans/30`

Only after the above. Its whole value is turning step 2 from «the agent remembered» into machinery
that runs whether or not anyone remembers — the fourth occurrence of that class this project has paid
for (`bugs/17`, `bugs/39`, `bugs/42`).

## §5. Risks

| Tier | Risk | Contingency |
|---|---|---|
| **(a)** | The run hangs the machine and adds to the disk exposure | step 2 removes the writers that were writing to the damaged volume; the run is short (2 rungs) |
| **(a)** | `chkdsk /scan` finds outstanding corruption and we run anyway | AC2 is a hard gate, not a preference |
| (b) | Stopping `ftpsvc` interrupts something the owner is using | it is his machine, he is at it, and the receipt makes it one command back |
| (b) | The holes' band refuses in the dry run (a lone rung may have no ceiling holder) | fall back to the engine's own derived band, which is already proved exit-0 |
| (c) | The torrent client refuses to pause cleanly | note it and proceed — its handles are on E:, not the damaged J: |

## §6. Decisions made without the owner

*(filled at closing)*
