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
