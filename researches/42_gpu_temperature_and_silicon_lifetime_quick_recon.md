# Research 42 — GPU temperature and silicon lifetime: a quick recon

> **Created:** 2026-10-18 (session 113, the owner's ask «быстрая разведка в интернете, краткая» on «какую температуру считаешь оптимум, чтобы на 80% продлить жизнь GPU»)
> **Parent:** `testcases/reports/2026-10-18_gcc_fan_curve_short_check.md` (the thermal model T = 22.2 + P·(0.1411 + 3.013/fan%))
> **Status:** recon done 2026-10-18 ~11:5x; the owner's choice of the plateau target is open
> **Outbound:** the target temperature → the owner (chat)

## Findings (three standard web searches, secondary sources named)

1. **The law is Arrhenius:** life factor = exp[(Ea/k)(1/T₁ − 1/T₂)]. JEDEC JEP122H lists failure mechanisms with their activation
   energies (the standard itself is behind the JEDEC paywall — the electromigration value was NOT read). Ea ≈ 0.54 eV gives ×2 per
   10 °C near room temperature (a worked example on the Beowulf list); «−50 % life per +10 °C» is the industry rule of thumb (JetCool).
   Sources: https://www.jedec.org/node/8597 · https://beowulf.org/pipermail/beowulf/2005-March/012173.html ·
   https://www.jetcool.com/post/semiconductor-lifetime-how-temperature-affects-mean-time-to-failure
2. **Two different wear classes** (Igor's Lab on Blackwell): a constant high temperature wears transistors and metallization
   (electromigration — 100 vs 80 °C ≈ ×2.4…8.3 faster in his simplified model, explicitly NOT a lifetime prediction); large thermal
   CYCLES wear the package, solder and PCB, and the swing matters as much as the peak (40↔55 °C is not 35↔95 °C).
   Source: https://www.igorslab.de/en/blackwell-hotspots-and-the-endless-search-for-the-one-reliable-value/4/
3. **No controlled study of GPU life at 70 vs 80 °C was found**; forum lifetime figures are unsourced.
4. **RTX 5070 Ti limits:** max GPU temperature 88 °C (spec lists: Geeks3D, Fierce PC); the hidden hotspot reads up to ~107 °C while
   the average sensor reads ~68 °C (Pause Hardware, via NVIDIA MODS) — i.e. the hottest point of the die runs tens of degrees above the
   number `nvidia-smi` gives us. Sources: https://www.geeks3d.com/?p=10828 · https://fiercepc.co.uk/nvidia-geforce-rtx-5070-ti-16gb-graphics-card ·
   https://pausehardware.com/rtx-50-hotspot-mods-nvidia/

## Reflection — for THIS project

- ×1.8 life ⇔ ≈ 7…12 °C cooler (Ea 0.9…0.5 eV); ≈ 9 °C at 0.7 eV. Not a measured property of this die — a model with a named range.
- By our thermal model, ⚖️ at 250 W cannot reach 64 °C on fans at all (≈ 66 °C at 100 %); a target that low is bought with power.
- The zero-RPM curve makes a ~25 °C swing at every game start — the cycling class of finding 2; a higher, smoother idle floor is the lever there.
