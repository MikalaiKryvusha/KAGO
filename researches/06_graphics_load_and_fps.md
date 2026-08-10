# Research 06 — a game-like graphics load with an FPS number

> **Created:** 2026-08-10 18:5x +03:00 (agent, on the owner's instruction *«нужен какой-то опенсоурс 3D
> бенчмарк, который может приблизить тест к играм, чтобы ты мог FPS из него помирить»*, followed by
> *«я почти уверен, что в Github будет такой опенсоурс инструмент со множеством звёзд»*)
> **Parent:** `plans/05_epic01_phase5_vmin_engine.md` §4.3 (the diverse workload set) · the epic's AC5
> (what the price is measured with) · `researches/03` (which already settled why KAGO writes its own loads)
> **Status:** 🟢 sweep DONE 2026-08-10 — the GitHub census is measured, not recalled; **nothing has been
> downloaded, installed or run.** The owner's fork is open (§6)
> **Outbound:** the choice → the owner (§6) · whichever load wins → `plans/05` §4.3 as the game-like
> shape and the FPS price meter · the licence/dependency reconciliation → `GOAL.md`'s no-GUI constraint

---

## 1. Why this document exists — the gap it names

KAGO's oracle is strong exactly where the hobbyist method is weak: it compares a checksum against a
golden reference, so it sees the silent corruption that 37 of 57 programs produce before anything crashes
(`researches/02` §2). It has two blind spots of its own, and the owner named the second one:

1. **No game-like load.** The workload set is `sdc_fma` (fixed-loop arithmetic) and `branchy`
   (control-heavy) — both CUDA compute. Neither touches the rasterizer, the texture units, the RT cores,
   the display pipeline or the memory access patterns a renderer produces. An undervolt can be stable
   under compute and unstable in a game, and `researches/02` measured exactly that class: Vmin spreads
   **100 mV between programs**.
2. **No FPS.** The price in the owner's formula was being read off ops/s, and ops/s is **not** how this
   industry measures graphics performance — the industry uses frames per second, frametime stability and
   benchmark scores. Worse, ops/s was measured here to scatter **4.3 % between two stock runs**
   (EXP-0030), so it cannot carry a 1–4 % price claim at all.

## 2. What was searched, and how — so the census can be re-run rather than believed

The owner's hypothesis was that a popular open-source tool exists on GitHub. That is a **countable**
claim, so it was counted, using GitHub's own index rather than the agent's recall:

```
gh search repos "gpu benchmark"   --sort stars --limit 12
gh search repos "vulkan benchmark" --sort stars --limit 12
gh search repos "fps benchmark"    --sort stars --limit 12
gh search repos "gpu stress test"  --sort stars --limit 12
gh search repos "ray tracing benchmark" --sort stars --limit 8
gh search repos --topic benchmark --topic graphics --sort stars --limit 8
gh search repos --topic gpu --topic benchmark      --sort stars --limit 10
gh api repos/<owner>/<name> --jq '.stargazers_count, .license.spdx_id, .pushed_at'
```

## 3. THE CENSUS — the answer is "it does not exist"

**Every high-star repository matching "gpu benchmark" is a COMPUTE benchmark, not a graphics one:**
FluidX3D 5 217 ⭐ (CFD), NVIDIA/nvbench 916 ⭐ (CUDA kernels), mixbench 464 ⭐, OpenCL-Benchmark 313 ⭐,
BabelStream 374 ⭐ (memory bandwidth). The `topic:benchmark` ∩ `topic:graphics` intersection contains
**nothing above 88 ⭐** (`GL_vs_VK`, an API comparison). `"fps benchmark"` returns CS:GO/CS2 config
repositories, the largest being a frametime-log *charting* web app at 52 ⭐.

**The only genuine open-source graphics benchmark found is `vkmark`** — 242 ⭐, LGPL-2.1, last push
2025-09-09 — and its window-system backends are **X11, Wayland and KMS**. There is no Windows backend,
which disqualifies it here on the first criterion rather than on preference.

**Why the niche is empty, and it is the same finding `researches/03` already paid for:** the graphics
benchmark market is held by closed products — 3DMark, UNIGINE (Heaven/Valley/Superposition),
GravityMark, Basemark — and *their automation is sold separately, in paid editions*. That measurement is
what made KAGO write its own CUDA loads in the first place.

## 4. WHAT DOES EXIST with many stars — open-source GAMES with a built-in timedemo

This is the honest answer to the owner's hypothesis: he was right that something popular exists on
GitHub, and wrong about what it is. It is not a benchmark **tool**; it is a **game**, which for his stated
goal («приблизить тест к играм») is strictly better — it *is* the thing being approximated.

| Project | ⭐ | Licence | Last push | Benchmark entry point | Verified? |
|---|---|---|---|---|---|
| `id-Software/DOOM-3-BFG` | 5 363 | GPL-3.0 | 2024-08-21 | `timedemo` console command | id ✅, mechanism ❌ not verified |
| `supertuxkart/stk-code` | 5 295 | mixed | 2026-08-01 | a profiling/benchmark mode | id ✅, mechanism ❌ not verified |
| `Novum/vkQuake` | 2 242 | GPL-2.0 | 2026-08-08 | `timedemo` (QuakeSpasm lineage) | id ✅, mechanism ❌ not verified |
| **`NVIDIA/Q2RTX`** | 1 317 | GPL-2.0 | 2025-12-11 | `timedemo 1; demo q2demo1` | id ✅, command from the project's own changelog |
| `Unvanquished/Unvanquished` | 1 119 | mixed | 2026-07-17 | `timedemo` (Daemon engine) | id ✅, mechanism ❌ not verified |
| `xonotic/xonotic` | 515 | mixed | 2026-08-06 | `-benchmark demos/the-big-keybench` → fps min/avg/max | id ✅, flag documented by third parties |

**Rows marked "not verified" are exactly that.** This document does not claim a mechanism works because a
forum said so; the verification is a run, and no run has happened (§5's gate).

## 4a. CAN WE DRIVE IT FROM A SCRIPT? — answered by someone else's WORKING profile, not by hope

The owner asked whether any of these can be driven by the agent and by KAGO's own tooling. There is a
much better witness than a README: **Phoronix Test Suite ships a test profile for Quake II RTX, and it has
a `install_windows.sh`** — PTS is a fully non-interactive benchmark harness, so a profile existing at all
is proof that the game runs, benchmarks and exits **with no human touching it**, on Windows.

`pts/quake2rtx-1.6.1/test-definition.xml`, quoted:

```xml
<ResultScale>Frames Per Second</ResultScale>
<SupportedPlatforms>Linux, Windows</SupportedPlatforms>
<SoftwareType>Game</SoftwareType>   <TestType>Graphics</TestType>
<Status>Verified</Status>           <TimesToRun>3</TimesToRun>
<RequiresDisplay>TRUE</RequiresDisplay>
```

And the invocation their Windows script generates — this is the whole recipe:

```
q2rtx.exe +set ray_tracing_api <backend> +demo q2demo1.dm2 +timedemo 1 \
          +set r_mode -1 +set r_customwidth W +set r_customheight H \
          +set vid_fullscreen 1 \
          +set pt_num_bounce_rays <0|0.5|1|2> +set flt_enable <0|1> \
          +set nextserver quit
```

FPS is then read out of the game's own console log:

```
RESULT_LINE=$( grep "frames" .../baseq2/logs/console.log )
FPS_VALUE="${RESULT_LINE##*: }"
```

**Every property C2/C3 demand is present, and each is a line above rather than an inference:**

| Need | How it is met |
|---|---|
| starts without a GUI click | every setting is a `+set` cvar on the command line |
| **ends by itself** | `+set nextserver quit` — the game quits when the demo finishes. This is the one that makes an automated loop possible at all |
| FPS in a parseable form | the `frames` line in `baseq2/logs/console.log`; the changelog notes the printed FPS precision was *increased* for timedemos |
| load level is OUR choice | resolution (`r_customwidth/height`), bounce rays (`pt_num_bounce_rays`), denoiser (`flt_enable`) — so the load can be sized to saturate this card |
| the free data is enough | `q2demo1.dm2` is the shareware demo level; the retail pak files are not needed and not redistributable anyway |
| repeatability | PTS runs it `TimesToRun 3` — which also tells us its authors treat one run as insufficient, exactly as EXP-0018 does |

`supertuxkart` also carries an `install_windows.sh`, so it is scriptable too — but it does not clear C4.

## 4b. WHY NOT FURMARK — and the first reason is that the owner already ruled on it

He asked directly. Three answers, in the order that matters:

1. **HE EXCLUDED IT HIMSELF, and that decision is recorded.** Interview 001, Q2 = **A**:
   *«Не пускать вовсе. Ни в зависимостях, ни на стенде.»* An agent quietly reversing the owner's own
   recorded decision is worse than any benchmark choice, so it stays excluded until he reopens it — which
   costs him one sentence and is entirely his to do.
2. **It is the WRONG SHAPE for what we are testing, and this project measured why.** FurMark is a flat
   100 % shelf. `researches/02` §2 measured that the dominant cause of Vmin variability is **voltage noise
   — IR drop and di/dt droop** — so *transitions* are what expose an unsafe undervolt, and a steady
   furnace is the one shape that produces none. The industry sweep in §6 of that document says the same
   thing in plainer words ([wccftech](https://wccftech.com/how-to/how-to-properly-stress-test-your-gpu/):
   FurMark alone is not enough). We already own the shapes that beat it: `--transient` (5 s on / 5 s off)
   and `--lowload` (1 s on / 9 s off).
3. **It is the opposite of "closer to games".** A torture donut is not a renderer with a game's geometry,
   shader and memory-access patterns — it is a power-draw maximizer, which is a legitimate *thermal* test
   and a poor *game* proxy. It is also closed source, so it fails C6's first half.

**What FurMark would genuinely add, stated fairly:** a harder thermal/power ceiling than our loads reach
(the compute loads saturate at ~137 W of a 300 W limit), and it does print FPS and is CLI-drivable. If the
owner reopens it, that is what it buys — and it buys nothing about undervolt stability that the transient
shape does not buy better.

## 5. THE CRITERIA — and the one that eliminates most of the list

A candidate has to satisfy all of these, and they are ordered by how cheaply they disqualify:

| # | Criterion | Why it is not negotiable |
|---|---|---|
| C1 | **Runs on Windows 11** | this is the owner's machine; `vkmark` fails here |
| C2 | **Driven from the command line, no GUI clicking** | the load runs inside an automated search loop |
| C3 | **Prints FPS / frametimes we can parse** | a number a human reads off a screen is not a meter |
| C4 | **ACTUALLY SATURATES A 5070 Ti** | the decisive one — see below |
| C5 | **Repeatable enough to compare two runs** | a delta thinner than the load's own scatter is not an effect (EXP-0018, EXP-0030) |
| C6 | **Open source, and no third-party GUI in KAGO's dependency list** | `GOAL.md`, the owner's standing constraint |

**C4 is what removes Quake, Xonotic, Doom 3 and vkQuake from serious consideration.** Those engines are
from 1997–2012; on a card of this class they run at three- to four-digit frame rates and become **CPU
bound**, which means the FPS number measures the Ryzen 5700G and the driver's submission path, not the
GPU under test. A load that does not saturate the subject cannot price it — and this project has already
been bitten by exactly this: the compute workloads reached **8 % GPU utilization** until the sustained
shape was built (fact 8).

**Only path tracing clears C4 from that list.** `Q2RTX` renders with full path-traced global illumination
through Vulkan ray-tracing extensions and uses the RT cores — that is a load a 5070 Ti cannot shrug off,
and it exercises hardware our CUDA loads never touch.

## 6. THE TWO ROUTES, and the fork that belongs to the owner

### Route A — Q2RTX as the game-like load

**For:** it is a real game; path tracing genuinely saturates this class of card; RT cores and the
rasterizer get exercised for the first time in this project; `timedemo` is the project's own documented
mechanism; GPL-2.0; NVIDIA-authored, so the Vulkan RT path is the vendor's own.

**Against, and both are real:**
- **THE REPOSITORY IS DISCONTINUED.** Its README opens with *"This repository is no longer maintained."*
  The last release is **v1.8.1, 2025-12-11** — a **999 MB** Windows installer. Nothing about driver
  610.88 or Blackwell has been tested by its authors, and nobody will fix it if the RT extensions moved.
- **It is a third-party application installed on the owner's machine** (§7).

### Route B — KAGO writes its own graphics load, as it already did for compute

**For, and one of these arguments is stronger than anything Route A offers:**
- **a rendered frame can be HASHED.** Our compute oracle works because the output is checkable exactly;
  a third-party benchmark reports FPS and nothing about correctness, so an undervolt that corrupts
  *pixels* would pass it. Rendering to an offscreen target and hashing it gives an **SDC oracle on the
  graphics and RT path** — a capability no benchmark on the list provides;
- deterministic by construction: our scene, our frame count, our camera path — C5 satisfied by design;
- zero third-party dependency, so `GOAL.md` is untouched;
- it is the same decision the project already made once, for the same reason (`researches/03`).

**Against:** it is real work — a Vulkan or D3D12 renderer, a scene, and a build step — and it will never
look like a modern game's shader complexity. It approximates the *class* of load, not a specific game.

### The fork, stated for the owner, with the recommendation first

**Recommended: A first, then B.** Route A is a download and a run — hours, not days — and it answers a
question B cannot answer cheaply: *does a real path-traced game load even destabilize this card at the
undervolt we found?* If it does, we have learned something no synthetic load would have told us. Route B
is then the durable instrument, planned with A's evidence in hand rather than guessed at.

**What the owner is actually deciding:** whether a third-party application may be installed on his machine
for the test bench. Not a methodology question — a machine question, and his.

## 7. The `GOAL.md` reconciliation — stated rather than assumed

His standing constraint is *«Не хочется GUI приложение стороннее иметь в зависимостях для KAGO»*, and it
was aimed at MSI Afterburner: a GUI application in the **control** path, required for KAGO to work at all.
A benchmark is a different role, and the distinction is mechanical rather than rhetorical:

| | MSI Afterburner (forbidden) | a benchmark on the test bench |
|---|---|---|
| in `package.json` / the dependency tree | yes | **no** |
| needed for a shipped profile to apply | yes | **no** |
| needed for KAGO to run on a fresh machine | yes | **no** — a missing benchmark makes one workload shape unavailable and nothing else |
| GUI required to operate | yes | **no** — command line only, or it fails C2 |

So the honest reading: a CLI-driven, open-source benchmark used **only** for characterization does not
violate the constraint — but it is the owner's constraint, so the reading is put to him rather than
adopted. And the boundary that keeps it honest: **if the load ever becomes required for a profile to
apply, it has crossed into the forbidden role.**

## 8. What this document does NOT establish

- **Nothing has been downloaded, installed or run.** Every mechanism in §4 is somebody else's claim; the
  first run is what turns any of it into a fact, and installing software on the owner's machine is the
  destructive class under the owner's-machine rule — it needs his word, which is §6's fork.
- **Whether Q2RTX works on driver 610.88 / Blackwell at all** — unknown, and unknowable from reading,
  because its authors stopped testing.
- **Whether its timedemo output is stable enough to price a 5 % effect** — its own run-to-run scatter has
  to be measured before any delta is called an effect, exactly as the power meter's was (EXP-0018). A
  benchmark's FPS number is an instrument like any other and inherits the same rule.
- **What the FPS number means for the owner's real use.** His Palworld session stays the second witness
  (`AGENT_GUIDE.md` → Notes from the human); a benchmark is evidence, not his experience.

## 9. Sources

- GitHub's own index, queried 2026-08-10 (the exact commands are in §2) — star counts, licences and last
  push dates in §3 and §4 are quotes from `gh api`, not estimates
- [NVIDIA/Q2RTX](https://github.com/NVIDIA/Q2RTX) — the README's discontinuation notice, the GPL-2.0
  licence, the Q2VKPT/Q2PRO lineage; release v1.8.1 (2025-12-11), assets `q2rtx-1.8.1-windows.exe` 999 MB
- [Q2RTX changelog](https://github.com/NVIDIA/Q2RTX/blob/master/changelog.md) — *"increased precision of
  printed FPS when running timedemos"*, and the `timedemo 1; demo q2demo1` form
- [vkmark](https://github.com/vkmark/vkmark) — LGPL-2.1, X11/Wayland/KMS backends, per-scene FPS and a
  final score; no Windows backend
- [Xonotic benchmark flag](https://openbenchmarking.org/test/pts/xonotic) and community results
  ([TechPowerUp](https://www.techpowerup.com/forums/threads/xonotic-the-big-keybench-demo-results.317981/))
  — `-benchmark demos/the-big-keybench`, fps min/avg/max, 10 510 frames
- `researches/03` (this project) — the measurement that mature benchmarks sell automation only in paid
  editions, which is why KAGO writes its own loads
