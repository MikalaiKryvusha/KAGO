# Bug 142 — the apply reference stays on driver 610.88: its R6 stamp gate is never asked, and retaking it on 616.92 never settles under load

**Status:** 🔴 OPEN — observed 2026-09-25 on the live card (session 104); no fix yet
**Severity:** S2 — the curve every mode is computed against is a 610.88 recording; two 4-minute load runs lost at the owner's machine
**Version/build:** HEAD `40e2c86` · **When/context:** card evening 2026-09-25, `plans/102` Ш8 п. 2б

## Symptom

1. **The stale reference is USED, not rejected.** Every apply of a snapshot mode that evening printed
   «ОПОРА: артефакт худшего случая (снята 2026-08-31T23:13:42+03:00 при 68 °C …) · опора ↔ карта сейчас: расходится
   N точек из 127» (N = 72 at the 19:10 CLI apply, 67 later — the count follows the card's state). The reference
   `curves/reference-table.json` is stamped 610.88; the card is 616.92. R6 says a driver change invalidates it
   (`curve-store.referenceUsableFor` does check the stamp) — but `profile-manager` calls it with `{ card: cardStamp }`, and
   `cardStamp` defaults to `null` (`profile-manager.mjs:683`); no production caller passes it (grep at `40e2c86`: only
   selftests at `:2883 :3011 :3044 :3222`). So the stamp half of the gate is never asked.
2. **Retaking it fails.** `npm run curve -- --take-reference` twice (19:01, 19:26): «таблица не прочитана: таблица кривой не
   устоялась за 12 проб» (`nvapi.readVfCurveStable`, `curve-store.mjs:3405`) — under steady `furnace` load the table
   slides with heating and two consecutive identical reads never come within 12 samples. Zero writes to the card.
   ⚠️ **Found by the judge, not by me:** each failure coincides with the ONLY two `nvlddmkm` events since 18.09 — id 153
   «Error occurred on GPUID: 100» at **19:01:08** and **19:27:07** (Windows System log). The driver's own error channel
   spoke exactly when the reference reading ended; whether the loaded-table reads cause it or the failure path does is
   unknown — investigate BEFORE a third attempt (`npm run drivervoice`, `npm run events -- --since 2026-09-25`).
3. Consequence seen: the vector computed against this reference, judged against the COLD live table, inverted the
   curve order. Refusals on disk (journal): seq 6 (band margins), seq 8 (+10), seq 9 (+20) at 42–43 °C; +20 had passed a
   smoke warm (seq 7). The +30 refusal at 41 °C was seen once by a seam probe at 19:27:55 — its output lives only in the
   session, not on disk. Since `40e2c86` the order is clamped downward instead of refused — the symptom is gone; the
   stale base is not.

## Finding 2026-09-27 (session 106) — the driver's 153 was the echo of OUR kill, witnessed

- **Archive (offline):** the 610.88 reference's own stamp reads `takenAt 2026-08-31T23:13:42` and the System log has
  `nvlddmkm` 153 at **23:13:42** the same night — so ALL THREE captures (31.08 success · 25.09 19:01:08 failure ·
  25.09 19:27:07 failure) carry a 153 in the second the capture ended. Every capture ends in `finally { load.kill() }`:
  the load is a `stress-tester` node process whose `furnace.exe` child sits in libuv's kill-on-close job object, so
  killing the parent terminates the CUDA process mid-kernel.
- **Controlled experiment on the live card at factory** (0 non-zero offsets of 128, driver 616.92, owner at the machine):
  `stress-tester --workload furnace --seconds 60` started 23:42:16, `Stop-Process` at **23:42:36** → `nvlddmkm` **153 at
  23:42:36**; control: the same burn, 30 s, natural end 23:43:18 → **0 events**. `plans/105` P105-AC1 met.
- **Consequences:** (1) the 25.09 failures were NOT caused by the driver — the table simply never settled under load
  (the refusal came first, the kill's echo after it); (2) the mode check is clean of this echo: its burns end by
  themselves and only the telemetry sampler (no CUDA) and a timed-out game are ever killed; (3) any future tool that
  must stop a burn waits for it — a kill costs a 153 in the owner's log.
- **Fix (this session, `curve-store.cmdTakeReference`):** the load is a chain of 20-s chunks that end by themselves and
  the stop awaits the running one; the base is read `REFERENCE_READS` = 8 times and the WORST case per entry is kept
  (`worstCaseBase` — the lowest base frequency, the artefact's meaning per `bugs/97`), with the spread printed instead
  of refusing; the regime is re-checked after the reads. Hygiene: `curve --selftest` blocks «ХУДШИЙ СЛУЧАЙ…», mutations
  MW1–MW3. Functional run: the live capture of `plans/105` Ш6.

### Two more refusals the same night — the LOAD SHAPE, not the table (2026-09-27 23:52 · 23:56, zero writes)

`npm run curve -- --take-reference` with the new code refused twice with «карта не вошла в режим… не удержала его 20 с»:
first with 20-s chunks (the idle gap between chunks — startup and the event-log query — reset the hold every fourth
5-s sample), then with 60-s chunks (samples still at ~70–80 W inside a chunk). Cause: `stress-tester --seconds N`
WITHOUT `--sustain` is a train of short `furnace.exe` launches — 42.6 % GPU time in the control run of 23:42:47 — so a
5-s sample often lands between launches. The 31.08 capture passed on the same shape by luck of sampling. Fix in the
tree (`c` below, `[NOT-TESTED]` on the card): the chunk spawns `--sustain <chunk>`, one burst holding the card the
whole chunk. Driver events after 23:43:20: **0** (the stop waited, no kill).

**The stamp gate's production branch is HELD OFF** (`profile-manager.resolveProfileCurve`): armed with only the 610.88
reference on disk it moved the ⚖️ shortcut to the live-subtracted base — a vector the 25.09 check never proved. Re-arm
it in the commit that lands the 616.92 reference, then re-check Optimised (`plans/105` Ш6–Ш7). The injectable half
(`probeStampFn`) and its block stay.

**Fixing:** next card evening, `plans/105` Ш6 (capture with `--sustain`) → re-arm the stamp → Ш7.

## Fix plan (offline first)

1. Take the reference at a THERMAL PLATEAU (the project has a plateau detector, `npm run thermal -- --analyze`) or accept
   per-point the WORST (lowest-frequency) value over N reads — «worst case» is the reference's stated meaning (bugs/97);
   demanding two identical reads under load contradicts it.
2. Then pass the live card stamp into the applier (`cardStamp`), so a stale reference is rejected by name — ONLY after a
   616.92 reference exists, or every mode loses its base (the fallback is the live-subtracted path, `bugs/98`).
3. Re-check `bugs/136` (non-monotone reference) on the new one.

## Decisions made without the owner

- `[AI]` Tonight's accepted Optimised (margin 0, 5-min check passed) was computed against the 610.88 reference —
  consistent with what the check proved; a new reference changes the applied curve and needs a re-check.

## Links

`bugs/97` · `bugs/98` · `bugs/136` · `plans/103` · commit `40e2c86`
