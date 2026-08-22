# Bug 27 — the watch window freezes for most of a run, because the server that feeds it lives inside the very process that blocks for every stress test

**Status:** ✅ **FIXED 2026-08-22** — three doors closed, mutation BA proves the guard red, verified LIVE on the card (853 frames / 242,6 s = 3,52/s against 0,16; zero gaps over the animation leash). See «THE FIX AS BUILT» below
**Version/build:** `main` @ `ace10a0` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-22 14:30…14:34 +03:00, the live run
`engine --sweep --from 2842 --to 2842 --dashboard` (the run itself succeeded, exit 0, edge closed).
The owner, watching: *«висит визуализатор. время локальное тикает — всё остальное висит»*, and then
the requirement, in his words: *«НИЧТО НЕ ДОЛЖНО ЕГО ДЕРЖАТЬ В ЗАВИСШЕМ СОСТОЯНИИ, НИЧТО!!!! …
единственное, из-за чего он может зависнуть — зависание ОС полностью. смерть ОС, но не
программно!!!»*

## Symptom

Every readout on the page stands still — the seven-segment displays, the tiles, the accepted
animations — while the wall clock in the corner keeps ticking. It is not a rendering fault: the wall
clock is the one element the browser drives itself (`_wiring.js:167-175`, deliberately). Everything
else is a function of the last pulse, and the pulses stop arriving.

**This is the instrument's own alarm signal being emitted by a HEALTHY run.** The window exists so
that a frozen picture means a hung machine (`ideas/06`; the owner's standing ban on runs without it).
A run that freezes the picture three times a minute while working perfectly destroys exactly the
signal the window was built to carry.

## The measurement that identifies the cause

Both numbers come from the same 259-second window of the same run:

| Writer | Process | Updates | Gap |
|---|---|---|---|
| telemetry sampler → `runs/dashboard/telemetry.jsonl` | **separate** (`hardware-mon.mjs`, spawned at `engine.mjs:5610`) | **260** | avg 1000 ms, **max 1132 ms** |
| pulse → the page (`seq` in `runs/dashboard/live.json`) | **inside the sweep** | **42** | avg **6.2 s** |

The card's readings existed every single second. Nothing was there to deliver them.

With `LEASH_MS = 1500` (`_wiring.js:18`) the animation is allowed to run 1.5 s past the last pulse and
then stands dead by design. **1.5 s of motion per 6.2 s of run — the picture is frozen ~76 % of the
time**, and for the full ~10 s of every stress test.

## Root cause — two doors, and the second is the one nobody saw

### A. The server is hosted inside the process that blocks

`engine.mjs:5560` raises the dashboard **in-process** (`raised.s`), and the sweep blocks synchronously
inside every burn — the module's own comment states it: *«the sweep is blocked inside the burn and
cannot sample its own card (`ideas/06` §A)»*. A blocked event loop serves no HTTP and no SSE, so for
those ten seconds the page is not slow — it is disconnected from a process that cannot answer.

The remedy for this was already designed and built. `pulseNow()` merges the card's readings from the
separate sampler, and computes the stress-test seconds itself, with this reason written above it
(`run-dashboard.mjs:386-388`):

> *«Merged HERE rather than pushed by the run, because the run is precisely the thing that is busy.»*

**The cure for "the run is busy" was installed inside the run.**

### B. The broadcast is gated on a counter only the blocked party can move

Even with a free server, the merge cannot reach the page. `run-dashboard.mjs:553`:

```js
if (p.seq === lastSeq) return;   // and `seq` is bumped only by the run writing a pulse
```

`pulseNow()` is recomputed every 200 ms and carries fresh temperature, fan, watts, clock and probe
seconds — **none of which is in the trigger**. The comment explains that the age was left out of the
trigger on purpose, to avoid a 5 Hz broadcaster; the same exclusion silently dropped the live card
readings, which are the entire reason the merge exists.

So the chain is: the run cannot speak → the server that could speak for it is inside the run → and
the gate that would let it speak is keyed on the run speaking.

## Repro (deterministic, offline — no GPU writes)

```
npm run bench -- --from 2842 --to 2820 --dashboard
```

Watch the page: between pulses the readouts stand still, and the wall clock keeps ticking. Count the
`seq` in `runs/dashboard/live.json` against the line count of `runs/dashboard/telemetry.jsonl` over
the same interval.

## Fix plan

1. **The server moves out of the sweep's process.** Spawn `run-dashboard.mjs` the way the telemetry
   sampler is already spawned (`engine.mjs:5606-5622`) — a separate process, `unref`ed, killed on
   every exit path. That module's `main()` already serves, opens the window and closes it on any exit,
   so nothing new is invented; what changes is only WHERE it runs.
2. **The broadcast triggers on the PAYLOAD changing, not on `seq`.** Compare the serialised pulse with
   `ageMs` excluded (it moves every tick and would make this a 5 Hz broadcaster with nothing to say).
   Then a fresh telemetry line reaches the page ~1 Hz, and a run that truly stops still freezes the
   picture — the safety property is kept, not traded away.
3. **A dead feed is stated, never mimed.** `_wiring.js:164` swallows the disconnect
   (`es.onerror = () => {}`), and the freeze alarm is suppressed for a finished run
   (`_wiring.js:130`, `!pulse.run.finished && …`). A page whose server is gone therefore sits forever
   with a ticking clock and no way to say so. The link state becomes its own fact on screen, and the
   page keeps trying to reconnect so a new run relights it.
4. **Guards, proved red first** (EXP-0008). Mutation addressees, named before the run:
   (a) restore the `seq` gate → the block asserting a telemetry-only change reaches the page reddens;
   (b) host the server in-process again → the block asserting the sweep does not own the server reddens;
   (c) drop the link-state handling → the block asserting a dead feed is named on screen reddens.
   ⚠️ EXP-0075 at every site: guard every `find(...)`/field dereference a mutation can take away.

## Boundaries

- The accepted look is not touched. The mockup `homeworks/03_sweep_animation.html` stays the only
  drawing (`plans/20` §4.4); the page is rebuilt from it by `tools/build-dashboard-page.mjs`.
- The animation stays a FUNCTION OF THE PULSE. Giving it its own clock would make it a liar in exactly
  the case the instrument exists for — that property is the point, and this fix keeps it.
- Zero GPU writes to prove any of it: the bench rehearsal drives the same server and the same page.

## What the environment adds, recorded because it is new and it is not the cause

The machine moved into an enclosed mezzanine on 2026-08-22; the owner: thermal equilibrium now takes
**1…2 hours instead of 2…3 minutes**. He decided the runs continue unchanged
(*«тестируем как и раньше… ничего принципиального не меняй в прогонах»*), and this defect is
independent of it — it reproduces on the bench with no card at all. It is written down here because
every number this window shows from now on is a number measured in that box, and
`runs/dashboard/telemetry.jsonl`, where the temperatures live, is git-ignored.

## THE FIX AS BUILT — 2026-08-22

| # | Where | What |
|---|---|---|
| 1 | `engine.mjs:5559` | the dashboard is spawned as a **separate process**, the way the telemetry sampler already was — same pattern, same reason. Killed on every exit path (`exit` + `SIGINT`/`SIGTERM`), because on Windows a child does not die with its parent. The module's own `main()` already serves, opens the window and closes it on any exit, so nothing new was written — only WHERE it runs changed. |
| 2 | `run-dashboard.mjs:553` | the broadcast triggers on **the payload changing**, `ageMs` excluded — not on `seq`. `seq` is still part of the payload, so the gauge vanishing still reaches the page. Cost stated aloud: during a burn this broadcasts at the poll rate (5/s of a few hundred bytes on loopback). The safety property is kept — data stops, picture freezes. |
| 3 | `_wiring.js:155` | **the link is its own fact**, judged by `EventSource.readyState`, never by silence (silence is legal — between runs the gauge has nothing to say for hours). `onerror` no longer swallows the break; when the browser gives up (`CLOSED`) the page reconnects itself, so a new run relights the window with no human. |
| 4 | `_wiring.js:93` | the link is judged **first**, above the `frozen` check whose `!finished` was suppressing everything. Three distinct states, and only one is an alarm: a lost link under a RUNNING sweep (the case the instrument exists for). A normal finish and an idle wait are stated calmly — crying wolf on a routine ending is how the alarm gets ignored on the night it is real. |
| 5 | `run-dashboard.mjs:471` | seam `telemetryPath`, so the suite stops writing into the **production** telemetry file and restoring it from a backup. On an idle machine that was harmless; during a live run it would have erased the run's own evidence — and it was the last thing keeping this suite out of the battery. |
| 6 | `tools/selftest-all.mjs` | **`dashboard` joins the battery** (18 suites, 887 blocks) under the list's own rule — "one at a time, with the proof of inertness written next to the entry". Proof written there: ephemeral ports only, window functions injected as spies, all files in `runs/dashboard-selftest*`, and the production telemetry file's mtime unchanged across a run of the suite. |

### Verification

| Check | Result |
|---|---|
| `node run-dashboard.mjs --selftest` | **39 blocks**, 0 red (was 37) |
| `npm run selftest:all` | **18 suites, 887 blocks, 0 red**, 11.7 s |
| `npm run check` | 45 .mjs parsed, 270 texts, 0 corrupt |
| **Mutation BA** — restore `if (p.seq === lastSeq) return;` | 🔴 **reddens its own block and only it**: «за 900 мс секунды выросли на 0.2 (кадров 2, значения [0,0.2])». Clean code green before and after. |
| **Live, measured on the card** | during a burn with `seq` **frozen at 11**: **21 frames in 4 s = 5.3/s**, probe seconds 1.2→3.8, temperature and watts moving. Before the fix: **42 frames per 259 s = 0.16/s**. |

**The counting block was hollow at first, and the mutation is what said so.** «Frames ≥ 2» stayed green
on the defect, because the old gate still delivers two (the connect handler's frame, plus one because
`lastSeq` starts at −1). The assertion was rewritten to measure the property that matters — **do the
numbers on screen advance** — rather than the symptom's proxy. Same class as `bugs/16`'s hollow block,
caught this time by the mutation run instead of by a live run.

### Decisions made without the owner

1. **A normal finish is not an alarm.** A window whose run ended says so calmly and waits for the next
   one; only a link lost under a RUNNING sweep raises the red state. The alternative — alarm on every
   ending — is how the signal gets ignored the night it is real.
2. **The window is not closed at the end, it is RE-LIVED.** The owner's word was «он должен жЫть, а не
   висеть», so the page reconnects on its own rather than being shut. The engine still closes the
   window it raised, but a window the owner opened himself now survives honestly instead of frozen.
3. **`dashboard` was added to the battery inside this fix** rather than filed as a follow-up. It is
   the systemic half: this defect lived in a suite the battery never called — the audit's finding №2
   one floor down.

## Links

- `bugs/04` — the orphaned window that swallowed answers; `run-dashboard.mjs:1290-1298` names that
  shape and closes it for `npm run dashboard`, but only for that path.
- `bugs/14` — «нет данных» treated as «нечего сказать» instead of as a state. Same family, one layer up.
- `bugs/15` — the dashboard raised into a broken state.
- `ideas/06` — the window and the freeze detector; §A is where the side-car sampler was specified.
- `plans/20` — the dashboard on the bench; §4.4 is the build-from-the-mockup rule.
