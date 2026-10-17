# Plan 108 — ❄️ Silent Cold: the frequency ceiling over the Optimised curve, chosen by the fan on the PLATEAU (40…50 %)

> **Created:** 2026-10-17 18:2x (session 110) · **Parent:** `plans/101_EPIC…` (Ф3) · **Status:** ✅ Ш1–Ш3 2026-10-17 20:40 (session 111): cap 2205, plateau fan 48 %, РЕЖИМОВ ПРОВЕРЕНО 4/4; Ш4 — the
> comparison table vs stock (owner 20:3x) · **Outbound:** —

## Goal vector (Achieve)

**Pain:** three modes of four are checked (17.10 18:13 — Max Perfomance). Silent Cold is the last; its profile is the 22.08 draft
(stamp 610.88, `curveRef: measured`, cap 2797, `qualified: false`).
**Where we want to be:** Silent Cold on the shortcut — the Optimised curve (`4215c7`, one curve for all modes, `ЗАКАЗ.md` §1),
250 W, a frequency ceiling at which the fan on the game PLATEAU sits at ≤ 50 %, preferably 40…50 % (`ЗАКАЗ.md` §1, the owner
25.09: «не более 50, желательно оказаться в диапазоне 40...50»), checked whole, «РЕЖИМОВ ПРОВЕРЕНО 4/4».

## Acceptance criteria

1. The candidate (curve `4215c7`, cap C, 250 W) passes the 4-min mode check — Check: `runs/validate/<moment>/report.md` «ПРОЙДЕНА».
2. On a Q2RTX capture long enough to plateau (the plateau comes at 395…753 s under the game — STATUS fact 34+36), the detector
   reports a plateau with the fan ≤ 50 % — Check: `node automation-engine/lib/thermal-ladder.mjs --analyze silent-<C>` prints
   «ПЛАТО» and the fan; 40…50 % is the target, < 40 % means the ceiling may go UP (performance left on the table).
3. `npm run curve -- --progress` prints «РЕЖИМОВ ПРОВЕРЕНО 4/4»; the ❄️ shortcut witnessed (offsets + 250 W, two reads).

## Flowchart

```mermaid
flowchart TD
    A[candidate: curve 4215c7 + cap C + 250 W<br/>start C = 2797, the draft's] --> B[validate --step --mode silent-cold --minutes 4]
    B -- fails --> F[failure → floors by the instrument;<br/>re-step]
    B -- passes --> Q[profile → snapshot, qualified]
    Q --> G[apply by shortcut · Q2RTX capture ≈ 12 min<br/>gfx --capture --label silent-C --runs N]
    G --> P{plateau fan?}
    P -- "> 50 %" --> D[C one ladder step band lower] --> B
    P -- "< 40 %" --> U[C higher, if the fan allows] --> B
    P -- "40…50 %" --> Z[keep C · shortcut · 4/4]
```

## Steps

- [x] **Ш1. Check at the draft's cap 2797** (the owner present, under the KUMM lock): `npm run validate -- --step --mode silent-cold
  --band-margins 0,0,0,-10,-10,-10,10 --minutes 4` — the candidate inherits the profile's `curveCapMhz` (verify in the dry run that
  the cap lands in the candidate: `--dry-run` first).
- [x] **Ш2. Qualify and apply**: profile → snapshot, stamp 617.42, `qualified: true` (the fan criterion is still open — the
  evidence says so), ❄️ shortcut, two reads.
- [x] **Ш3. Fan plateau**: `npm run gfx -- --capture --label silent-2797 --profile silent-cold --runs <≈12 min>` → `thermal --analyze
  silent-2797`. Fan > 50 % → C lower and back to Ш1; < 40 % → C higher; 40…50 % → done.
- [ ] **Ш4. Close**: metric 4/4, area frames unchanged (the curve is the same), benefit table needs the stock 4-min check on 617.42.

## Risks

- (a) The 5-minute rule is for the MODE CHECK; the plateau capture is a measurement of ~12 min — named to the owner before it runs.
- (b) KUMM shares the machine: the capture holds the lock ~15 min — announce it, keep `until` honest.
- (c) A ceiling under ~2157 MHz cannot be held by the curve alone (internal map R11) — the clock bound `-lgc 180,C` holds it; the
  check's apply already sets the profile's bound (`graphicsClockLockMhz`), so C goes there as well as into `curveCapMhz`.

## Price (interview 017 Q5)

≈ 20 min of the card per ceiling tried (4-min check + ~12-min plateau), 1–3 ceilings → 20…60 min with the owner. Closes the project's
acceptance «4/4» (the week of use aside).

## Execution log — 2026-10-17, session 111

| moment | ceiling | check (4 min) | under Q2RTX | outcome |
|---|---|---|---|---|
| 20:03 | 2797 | FAILED — stall at 2737 (226 → 58 W), driver reset; floors misattributed to 2805 → `bugs/151`, fixed + journal correction | — | curve 4215c7 → d5b12a (2737…2797 +10 mV) |
| 20:10 | 2797 | PASSED (`runs/validate/2026-10-17T20-10-20`) | 2715 MHz, 248 W (power cap), fan 60–65 % rising | ceiling does not bind — too high |
| 20:15 | 2452 | PASSED (`…T20-15-51`) | 2452 MHz, 218 W, fan 52 % rising | too high |
| 20:21 | 2205 | PASSED (`…T20-21-32`) | 2227 MHz, 187 W, fan ≤ 45 % | qualified, shortcut 20:27 |
| 20:27–20:40 | 2205 | plateau capture 60 runs (`runs/graphics/silent-2205.json`) | **plateau 62 °C · fan 48 % · 180 W** · 2212 MHz · 47.7 FPS | ✅ in 40…50 % |

The estimate «power ∝ f·V² from stock anchors» predicted 191 W at 2452 and was wrong (218 W measured): on this curve the Q2RTX
power is close to linear in the delivered clock (218 W @ 2452 · 187 W @ 2227). Use measured points, not the V² model, to pick caps.

## Decisions made without the owner

- `[AI]` ceilings tried 2797 → 2452 → 2205 (estimates named in chat before each run); 2205 kept at fan 48 % — the upper part of
  40…50 % = the most performance under the limit; going up one rung (≈ +5 W) risks crossing 50 %.
- `[AI]` the ceiling is held by the curve only (bound stays 180…3090): the card delivers up to two grid rungs above it (2212…2227
  at 2205) as the factory table slides with temperature — measured, inside the fan criterion.
