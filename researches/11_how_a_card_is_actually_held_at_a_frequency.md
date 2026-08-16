# Research 11 — how a card is ACTUALLY held at a frequency, and why `-lgc` cannot do it

> **Created:** 2026-08-16, on the owner's instruction after the first live sweep stopped on its first
> rung (*«поищи в интернете. Мы что-то не понимаем про то, как управлять видеокартой»*)
> **Parent:** `ideas/03` step 7 · `bugs/12` · the first live sweep, 2026-08-16 11:17
> **Status:** 🟢 collected 2026-08-16 — web recon + three live probes on the owner's own card
> **Outbound:** corrects `bugs/12`'s chosen write shape → the sweep · a decision for the owner
> (what frequency a measurement is recorded against) → this document's §5

---

## 0. The question this document answers

The owner's `ideas/03` step 7 says, in capitals: *«Ставится частота. ОНА ФИКСИРУЕТСЯ В ВИДЕОКАРТЕ.
ВИДЕОКАРТА БЛОКИРУЕТСЯ РАБОТАТЬ ИМЕННО НА ЭТОЙ ЧАСТОТЕ И НИ НА КАКОЙ ДРУГОЙ НИ ПРИ КАКИХ УСЛОВИЯХ.»*

His question in chat, after the first live attempt failed: *«неужели нельзя залочить карту на частоту,
чтобы она гарантированно на ней работала?»*

**The short answer, and it is measured on his card rather than argued: a clock lock holds a card DOWN
and cannot lift it UP. Nothing can force a card above the point its own boost arbitration picks.
What CAN be guaranteed is a CEILING — and the way to build one is to FLATTEN the V/F curve, not to
lock the clock.**

## 1. What was measured on this card (2026-08-16, three probes, card released clean after each)

| # | What was ordered | What the card did under load | Throttle reasons |
|---|---|---|---|
| 1 | sweep rung: curve +45 МГц capped at 3090, `-lgc 3082,3082` | **2917 МГц**, rock-steady 7 samples | `0x0` — NONE |
| 2 | `-lgc 3082,3082` by hand, factory curve | **2887 МГц**, rock-steady 6 samples | `0x0` — NONE |
| 3 | `-lgc 2700,2700` by hand, factory curve | **2692 МГц** (one ladder step below), rock-steady 5 samples | `0x0` — NONE |

Conditions for all three: `sdc_fma` load, utilization 51–57 %, **power 111–136 W of a 300 W limit**,
temperature 60–63 °C, fan 30 %, pstate P1.

**The card was not limited by anything we can see.** Not power (45 % of the envelope), not
temperature, not any reported throttle reason — the field read `0x0000000000000000` on every sample
of every probe. It simply does not go above ~2887 (factory curve) / ~2917 (curve raised 45 MHz)
under this load, and no clock lock changes that.

Probe 3 is the control, and it is the important one: **the lock DOES work — downward.** Asked for
2700, the card delivered 2692 and never moved. So the mechanism is not broken; its direction is one-way.

## 2. What the sources say — `-lgc` is a ceiling

`nvidia-smi --lock-gpu-clocks` sets **the upper bound the clock may not exceed**, not a clock the card
is commanded to hold. The GPU continues to operate BELOW that bound whenever its own arbitration
decides to ([indii.org](https://indii.org/blog/fix-clock-speed-on-nvidia-gpu/),
[NVIDIA developer forums](https://forums.developer.nvidia.com/t/sudo-nvidia-smi-lgc-lmc/284479)).

Passing `min = max` does not change this: the minimum is a request the arbitration may refuse, and
probes 1 and 2 above are that refusal, measured.

⚠️ **This retires an assumption the project has carried since phase 5.** `ladder-descent.candidateProfile`
sets `min = max` and the codebase describes the result as «приколоченная карта» — a nailed-down card.
It is nailed down only from ABOVE. Every past measurement taken at a pin BELOW the card's natural
boost point is unaffected (probe 3 shows that case works); measurements that assumed a pin could hold
a clock ABOVE it never existed, because until today nothing tried.

## 3. Why the card refuses to climb — the reliability voltage

The V/F table on this card runs to **1240 mV / 3187 MHz**. The boost algorithm never applies the top of
it. The limit is the **reliability voltage**: the highest point of the V/F curve the boost algorithm is
permitted to use, well below the table's own top (on an RTX 3050 measured by SkatterBencher it is
~1.081 V against a table reaching higher — [SkatterBencher #62](https://skatterbencher.com/2023/10/22/skatterbencher-62-nvidia-geforce-rtx-3050-overclocked-to-2220-mhz/),
[GPU Boost](https://skatterbencher.com/nvidia-gpu-boost-1-0/)).

So the frequency a card reaches is decided by **which VOLTAGE the arbitration is willing to apply**,
and the curve only decides what frequency that voltage buys. This is the owner's own framing arriving
from the other side: **V is the input the card chooses, F = curve(V) is what it gets.** Our tuning
document is keyed the other way (F → V) because that is the artifact the owner wants; the CARD reads
the same table in the opposite direction.

**Consequence for the search, and it is the whole point of this document:** we cannot ask the card for
a frequency. We can only change what each voltage buys, and then observe where it lands.

## 4. How a fixed frequency is ACTUALLY produced — flatten the curve

The technique every Windows undervolting tool uses, MSI Afterburner included: **pick the voltage point,
raise it to the target frequency, and FLATTEN EVERYTHING TO THE RIGHT of it**
([MSI's own guide](https://www.msi.com/blog/msi-afterburner-overclocking-undervolting-guide),
[curve editor tutorial](https://gist.github.com/st4rdog/d305609977037e64684a7932609446de),
[VoltGround walkthrough](https://voltground.com/hardware/msi-afterburner-voltage-frequency-curve-guide/)).
Afterburner's `L` key does exactly this to a selected point; `Shift+Enter` flattens a selection
horizontally.

Why it works where a clock lock does not: after flattening, **no voltage the card can choose buys a
higher frequency**. The ceiling stops being a request to the arbitration and becomes a property of the
table the arbitration reads. Whatever voltage it picks, the answer is the same frequency.

🟢 **KAGO ALREADY BUILDS THIS SHAPE.** `nvapi.buildRaiseAndCapVector` computes
`offset_i = min(Δ, cap − F_i)` — the whole curve up by Δ, and every point that would offer more than
`cap` **pushed down onto it**. That is the flattened curve, and it is the shape the project calls
«отгружаемая форма». It was right all along.

## 5. Where `bugs/12`'s fix went wrong, and the correction

`bugs/12` correctly found that step 7 was not implemented. Its fix chose: **cap the curve at the CARD'S
ENVELOPE (3090) and hold the frequency with `-lgc`.** §1–§4 above show why that cannot work:

- capping at 3090 flattens the curve at 3090, which is **not** a ceiling at the tested frequency — the
  card stays free to land anywhere below it, and it landed at 2917;
- `-lgc` was then asked to lift it back up to 3082, which no clock lock can do.

**The correction: the ceiling belongs at the TESTED FREQUENCY, and there must be no clock lock at all.**
That is the shape the engine wrote before 2026-08-16 — `bugs/12`'s diagnosis stands, its remedy does not.

**But `bugs/12`'s underlying objection also stands and must not be lost:** a capped card sits 20–30 MHz
BELOW its ceiling (measured: 2887 → 2857, 2917 → 2887, 2842 → 2812), so a voltage proved that way
belongs to a clock LOWER than the ceiling that was ordered. Recording it against the ordered frequency
is a claim nobody measured.

**The resolution the two findings force, and it is the one the engine can execute today:**

> **Flatten the curve at the tested frequency, no clock lock, and record the voltage against the
> frequency the card ACTUALLY DELIVERED — read under load — rather than against the one ordered.**

The engine already reads the delivered clock (`out.deliveredMhz`, median of loaded samples, plus the
max). What it does not yet do is CLOSE THE POINT AT THAT FREQUENCY. That is one change, in
`sweepFrequency` → `closePoint`, and it makes the tuning document say only things that were observed.

⚠️ **This is an owner-level decision, not an implementation detail** — it changes which row of his
document a measurement lands in, and it means the sweep's coverage is decided by where the card goes
rather than by the band that was asked for. Recorded here; the owner's answer belongs in `GOAL.md`.

## 6. What this means for the band a sweep can actually cover

On the factory curve under our load the card tops out at **2887 MHz**; with the curve raised 45 MHz,
**2917**. The top of the ladder (2895…3090 — 26 frequencies) is therefore **not reachable at all** until
the curve is raised enough that the reliability voltage buys those frequencies.

Two consequences:

1. **A sweep started at 3090 stops on its first rung, every time.** Not a defect — the card cannot go
   there. The owner's step 6 («от наивысшей частоты вниз») has to start at the highest frequency the
   card can actually deliver, and that frequency is itself a function of the raise.
2. **The undervolt search and the reachable top are the same knob.** Raising the curve to cheapen a
   frequency also moves where the card lands. This is worth stating plainly because it is the opposite
   of the mental model the project has been running on.

## 6a. Can the reliability voltage be removed? — the owner's question, 2026-08-16

*«нужно изучать дальше, как убрать напряжение надежности»* · *«карта НАША, что хотим о нее, то и
получаем»*.

**Answer from the sources: not in software, on a reference-design Blackwell board.** Four findings,
each with its own citation, and the third one retro-explains our own measurements:

1. **The whole over-voltage range on reference RTX 50 boards is ~0…20 mV** (0…100 % of the slider) —
   [Overclock.net RTX 5090 owners' club](https://www.overclock.net/threads/official-nvidia-rtx-5090-owners-club.1814246/page-340).
   An RTX 5090 reaches ≈1.075 V with the slider at 100 %, and the 50-series boost algorithm "rarely
   runs at that voltage under load" anyway.
2. **NVIDIA's voltage offset does not raise the ceiling — it moves WHEN voltage is taken.** The offset
   is limited to "the maximum voltage the GPU is allowed to pull at stock speeds"; its effect is to
   boost voltage EARLIER in the boosting table, not higher
   ([Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/nvidia-driver-595-71-reportedly-limits-overclocks-on-some-geforce-gpus-but-not-all-troubled-driver-release-seems-to-stifle-voltages-on-rtx-40-and-50-series-cards)).
3. 🔴 **THE VREL FLAG IS REPORTEDLY BROKEN ON BLACKWELL** ([Overclock.net, same thread](https://www.overclock.net/threads/official-nvidia-rtx-5090-owners-club.1814246/page-340)).
   **This retro-explains §1 of this document.** Every sample of all three probes read
   `clocks_event_reasons.active = 0x0` and we concluded "nothing is limiting the card". The limiter
   was active and SILENT. **A zero in that field on this card is not evidence of an absent limit** —
   a guard-worthy fact, and exactly the EXP-0011 class (a reading is true only under the conditions,
   and "the instrument reports this limiter at all" is one of them).
4. **Unlocked voltage control on RTX 50 is a BOARD property, not a software one.** MSI is preparing
   RTX 50 models with "triple channel voltage" specifically to gain that headroom
   ([Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/msi-afterburner-developer-adding-triple-channel-voltage-support-for-future-msi-rtx-50-graphics-cards),
   [TweakTown](https://www.tweaktown.com/news/107716/msi-prepping-new-geforce-rtx-50-series-gpus-with-unlocked-voltage-control/index.html)).
   No software creates it on a board that does not have it.

**The one real avenue that remains, NAMED AND NOT RECOMMENDED: a different VBIOS** carrying another
voltage table. That is flashing the card's firmware on the owner's working machine — irreversible on
failure, warranty-voiding, and squarely inside the owner's-machine rule's "destructive" set. It is
recorded here as EXISTING. It is not to be attempted without the owner's separate, explicit,
informed word.

**A second avenue worth a probe before anything drastic: the DRIVER.** Reports say driver 595.71
restricted voltage on 40- and 50-series cards ([Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/nvidia-driver-595-71-reportedly-limits-overclocks-on-some-geforce-gpus-but-not-all-troubled-driver-release-seems-to-stifle-voltages-on-rtx-40-and-50-series-cards),
[TechPowerUp](https://www.techpowerup.com/346977/nvidia-geforce-v595-71-drivers-reportedly-restricts-voltage-on-rtx-50-series-gpus)).
This machine runs **610.88**, which is later. Whether an earlier driver restores headroom on THIS
card is **unknown and unprobed**. ⚠️ A driver change invalidates every golden checksum and every
NVAPI id in this project until re-proved (R6) — it is not a cheap experiment.

### And the part that matters more than the ceiling

**The unreachable top is worth about 1 % of frames, measured on this very card.** Fact 25:
2760 → 2940 MHz (+6.5 %) moved FPS by **−0.21 %** on the RT-heavy frame and **+0.96 %** on the light
one. Six percent of clock buys one percent of frames.

**Everything this project exists for lives at 2700…2940 MHz** — where the card actually runs under
game load, and where every measurement above says we CAN work. The measured `Optimised` candidate
sits there: −50 W, −9 °C, fan 69 → 50 %, for −1.24 % frames. The top 26 frequencies of the ladder
are not the prize.

## 7. Open, and honestly unknown

- Whether the reliability voltage on THIS card can be read rather than inferred. NVAPI exposes
  pstates20 with a `NV_GPU_PERF_PSTATES20_PARAM_DELTA` structure
  ([NVAPI reference](https://docs.nvidia.com/nvapi/structNV__GPU__PERF__PSTATES20__PARAM__DELTA.html));
  whether the reliability ceiling is among the readable fields is **not established here**.
- Whether a HEAVIER load (Q2RTX, which saturates the card at 300 W — fact 16) moves the reachable top
  up or down. All three probes above used `sdc_fma` at 51–57 % utilization and ~135 W. **A value is
  true only under the conditions it was taken (EXP-0011), and these are those conditions.**
- Whether `-lmc` (memory clock lock) interacts. Not probed.

## Sources

- [nvidia-smi clock locking behaviour — indii.org](https://indii.org/blog/fix-clock-speed-on-nvidia-gpu/)
- [`nvidia-smi -lgc -lmc` — NVIDIA developer forums](https://forums.developer.nvidia.com/t/sudo-nvidia-smi-lgc-lmc/284479)
- [Locked frequency when profiling — NVIDIA developer forums](https://forums.developer.nvidia.com/t/locked-frequency-when-profiling/245597)
- [SkatterBencher #62 — reliability voltage in practice](https://skatterbencher.com/2023/10/22/skatterbencher-62-nvidia-geforce-rtx-3050-overclocked-to-2220-mhz/)
- [NVIDIA GPU Boost explained — SkatterBencher](https://skatterbencher.com/nvidia-gpu-boost-1-0/)
- [MSI Afterburner overclocking & undervolting guide](https://www.msi.com/blog/msi-afterburner-overclocking-undervolting-guide)
- [Afterburner curve editor tutorial — flatten and lock](https://gist.github.com/st4rdog/d305609977037e64684a7932609446de)
- [Afterburner V/F curve walkthrough — VoltGround](https://voltground.com/hardware/msi-afterburner-voltage-frequency-curve-guide/)
- [Per-point V/F curve control via undocumented NvAPI — LACT issue #936](https://github.com/ilya-zlobintsev/LACT/issues/936)
- [NVAPI pstates20 delta reference](https://docs.nvidia.com/nvapi/structNV__GPU__PERF__PSTATES20__PARAM__DELTA.html)
