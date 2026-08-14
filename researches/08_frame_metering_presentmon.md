# Research 08 — Frame metering: a game-independent FPS instrument (PresentMon)

> **Created:** 2026-08-15 02:2x +03:00 (agent, on the owner's word *«если PresentMon — опен соурс, то ставь»*)
> **Parent:** `plans/11` §4.5 (the acceptance witness) · EXP-0059 (free gameplay is a witness, not a
> meter) · `researches/06` (the graphics load and the Q2RTX-specific FPS parser this replaces)
> **Status:** 🔬 recon written BEFORE the tool touched the machine (checklist step 9). Install and live
> proof follow in the same session.
> **Outbound:** the instrument → a harness module wrapping it · the licence and provenance →
> `.gitignore` (`tools/bin/`, written BEFORE the download) · the vendor-neutrality claim → PROVED on
> this card or withdrawn

---

## 0. The gap this fills, stated as the thing that went wrong

The project has an FPS meter, and it reads **Q2RTX's own console log** (`graphics-load.mjs`). That ties
every frame number to one game. Two costs came due on 2026-08-15:

1. The owner's `Optimised` acceptance run was in **Palworld**, where the project has no frame
   instrument at all. His verdict had to be *«ориентировочно 5 %»* — an eyeball estimate that lands
   exactly on his own criterion's boundary, so it can neither pass nor fail it.
2. Even his stock session tonight yielded frames only as **«100–130 FPS»** read off an overlay.

**What this recon does NOT claim to fix, because EXP-0059 measured otherwise:** a frame meter does not
make free gameplay a controlled experiment. Two Palworld sessions visit different scenes — measured:
power drifted 272.8 → 253.4 W across one 152 s segment at a pinned 97–98 % utilization. The meter
turns «about 5 %» into a distribution with numbers; it does not turn a witness into a meter. The
criterion phrased in frames is still settled on a **repeatable** load.

## 1. What PresentMon is, and why it is the right shape for this project

| Fact | Value | How it was established |
|---|---|---|
| Author | Intel GameTechDev | GitHub `GameTechDev/PresentMon` |
| Licence | **MIT** | `gh api repos/GameTechDev/PresentMon --jq .license.spdx_id` |
| Repository state | live, not archived, 2 522 stars | same call |
| Latest release | **v2.5.1**, published 2026-06-29 | `gh api …/releases/latest` |
| Console build | **`PresentMon-2.5.1-x64.exe`, 956 KB, ONE file** | the release's asset list |
| Full build | `PresentMon-v2.5.1.msi`, 157 MB — GUI + service | same list, **deliberately not taken** |
| Mechanism | ETW — Windows' own Event Tracing, present events from DXGI/D3D | `README-ConsoleApplication.md` |

**Why the console exe and not the MSI, in the owner's own constraint's terms.** `GOAL.md` forbids a
third-party **GUI** in KAGO's dependencies. The MSI installs exactly that (an app plus a service);
the 956 KB console build installs nothing — no installer, no service, no registry key, no autostart.
**The complete uninstall is deleting one file**, which is the smallest reversible form the owner's
machine rule asks for.

**Why not NVIDIA FrameView instead**, which is the same measurement from the card's own vendor: it is
a GUI application, i.e. the thing `GOAL.md` names. It stays legitimate as the OWNER's manual tool for
one-off checks — and the two do not compete, because **FrameView uses PresentMon internally** (stated
in NVIDIA's own FrameView material). That fact is also the strongest available evidence for the point
below.

## 2. Vendor neutrality — what is evidence and what is still an assumption

**The console README makes NO statement about GPU vendors.** Recorded here as a gap rather than
papered over. The evidence that it works on this GeForce card is INDIRECT and of two kinds:

1. **Mechanism.** The events are emitted by Windows' graphics stack (DXGI/D3D present path), not by a
   vendor's driver telemetry, so the measurement is of the OS, not of the GPU.
2. **NVIDIA ships it.** FrameView is NVIDIA's own frame/power meter for GeForce cards and it uses
   PresentMon inside — NVIDIA would not build their GeForce instrument on a tool that cannot read
   GeForce frames.

**Neither was a measurement on THIS machine, and by this project's own rule that settles nothing**
(`PHILOSOPHY.md` → observation over conjecture).

**[TESTED: 2026-08-15 02:3x · a live Q2RTX timedemo captured 3 196 frames on this RTX 5070 Ti.]** The
claim is no longer indirect. Two things settled it within minutes of each other:

- **The owner found NVIDIA's own copy already installed on his machine** —
  `C:\Program Files\NVIDIA Corporation\FrameViewSDK\bin\PresentMon_x64.exe`, version **1.8.12407.0**.
  NVIDIA does not merely *use* PresentMon; they SHIP it, for GeForce, on this box. (Its `--help`
  returns exit 1 because 1.x takes SINGLE-dash flags — `-h`, `-process_name`; the double dash arrived
  in 2.x. Worth knowing before anyone calls that copy broken.)
- **Our pinned 2.5.1 measured frames on this card.** Numbers in §4a.

**Why the pinned copy is kept even though NVIDIA's is already there:** the vendored path lives under
`C:\Program Files\NVIDIA Corporation\` and appears, moves or vanishes with a driver/SDK install —
depending on it makes KAGO's frame meter a function of someone else's installer. Ours is version-pinned
(recorded in every run's record), git-ignored, and removable by deleting one file. NVIDIA's copy stays
the OWNER's manual instrument.

## 4a. The live proof, and what it does NOT yet prove

Q2RTX timedemo, 2 rays, 5 runs, stock card (`npm run gfx -- --run` with PresentMon attached):

| Quantity | Q2RTX's own console log | PresentMon 2.5.1 |
|---|---|---|
| frames | 631 per run, cold run DROPPED | **3 196 captured** |
| FPS, median | 53.495 | 54.981 |
| FPS, mean | — | 51.916 |
| **1 % low** | **the engine cannot report it** | **24.672** |
| frametime, median | — | 18.19 ms (min 0.68, max 917.52) |
| `MsGPUBusy`, median | — | 18.77 ms |
| `MsCPUBusy`, median | — | 17.89 ms |

**The agreement is of the right ORDER and is NOT yet a proper pair, stated plainly rather than
rounded off.** The two instruments measured different frame SETS: the engine averages each of five
demo runs and discards the cold one, while PresentMon recorded everything the process presented —
menus, loading (the 917 ms outlier is a load stall, not a frame), and the discarded cold run. A real
cross-check slices PresentMon's stream to the demo windows, and that is a job for the harness module,
not for this document. What §2's claim needed was frames on this card, and it has them.

**Two readings the project has never had:**

1. **1 % low of 24.7 FPS against a median of 55** — this load has stutter that an average hides
   entirely, and stutter is what a human actually perceives.
2. **`MsGPUBusy` (18.77 ms) EXCEEDS the median frame interval (18.19 ms)** — the card is busy longer
   than a frame lasts, i.e. this load is GPU-bound rather than CPU-bound. That is exactly the question
   the `Optimised` verdict could not answer: whether «fewer frames» came from our profile or from the
   scene and the CPU.

## 3. The invocation — literal flags, quoted from the console README

| Flag | What it does |
|---|---|
| `--process_name <name>` | record one executable by name; repeatable |
| `--process_id <id>` | record one PID |
| `--exclude <name>` | exclude an executable by name |
| `--output_file <path>` | write the CSV where we say |
| `--output_stdout` | CSV to the console instead |
| `--multi_csv` | one CSV per captured process |
| `--delay <seconds>` | wait before recording starts |
| `--timed <seconds>` | stop recording after N seconds |
| `--terminate_on_proc_exit` | stop when the target process exits |
| `--terminate_after_timed` | terminate after the timed capture ends |
| `--restart_as_admin` | request elevation if not already elevated |
| `--exclude_dropped` | omit frames never shown on screen |

**Elevation:** the README does not state that admin is REQUIRED; it provides `--restart_as_admin`,
which implies elevated access may be needed for the trace session. This project's shell already runs
elevated, so the question is settled by observation at first run rather than by reading.

## 4. The CSV — one row per presented frame

Columns that matter to this project, quoted from the README:

| Column | Meaning | Why we want it |
|---|---|---|
| `MsBetweenPresents` | interval between `Present()` calls | **the frame time — FPS is `1000 / MsBetweenPresents`** |
| `MsGPUBusy` | time at least one GPU engine was executing | separates «the GPU is the limit» from «the CPU is» — decisive for a profile that lowers clocks |
| `MsGPUTime` | total GPU work duration for the frame | the same question, second reading |
| `MsCPUBusy` | CPU work on the frame | tells us when a frame drop is NOT the card's fault |
| `DisplayLatency` | frame start → on screen | the owner perceives this, not the average |
| `MsUntilDisplayed` | `Present()` → displayed | the queueing half of the same |

**What this buys beyond an average FPS number**, and it is the part worth the install: per-frame data
gives **1 % lows** (stutter, which an average hides), and `MsGPUBusy` distinguishes a card that is
genuinely slower from a game that was CPU-bound in that scene. The eyeball number cannot separate
those, and that is precisely the ambiguity the `Optimised` verdict is stuck in.

## 4b. THE TOOL HAS STATE THAT OUTLIVES ITS PROCESS — paid for the same night

**Measured 2026-08-15 02:4x, and it cost the owner's Palworld window.** PresentMon opens a named ETW
trace session, and **killing the process leaves that session RUNNING in the system**. The next capture
then refuses to start:

```
error: a trace session named "PresentMon" is already running. Use --stop_existing_session
       to stop the existing session, or use --session_name with a different name.
```

The failure mode is what makes it expensive: the exe exits with **code 0**, so a caller that checks
the exit status sees success while no CSV is ever written. Two attempts died on a session left over
from the Q2RTX proof; by the time it was found and cleared with `logman stop <name> -ets`, the game's
render window (telemetry: 02:05:00 → 02:05:54) had passed and the owner had closed it. Zero frames,
and the tool was behaving correctly the whole time.

**This is a new KIND of state, so the internal map's R9a applies to it verbatim** — the undo learns it
BEFORE the first use, not after the first loss. What the harness module owes:

- a **unique `--session_name` per run** (`kago-<label>`), never the default;
- **`--stop_existing_session`** on every launch, because a previous crash is always possible;
- **stopping the session in a `finally`** — the process dying is not the session ending;
- **success judged by the CSV existing and carrying rows, never by exit code 0.**

Diagnostics for a future session: `logman query -ets` lists live sessions;
`logman stop <name> -ets` removes one.

## 5. How it will be driven — the shape, not the code

The same shape as the telemetry sampler (`hardware-mon`), for the same reason: a measurement process
must not be the process being measured.

- KAGO spawns the exe with `--process_name <game>` `--output_file runs/frames/<label>.csv`
  `--terminate_on_proc_exit`, and the game's own window is untouched.
- The CSV is parsed into the same record shape the power meter already uses, so `--spread` and the
  refusal-to-compare-unlike-runs rule (EXP-0011) apply unchanged.
- **The frames record carries the same stamp as everything else** (driver, VBIOS, profile, load) —
  R6 applies to a frame number exactly as it applies to a watt.

## 6. Risks

| # | Risk | Defence |
|---|---|---|
| R1 | The exe cannot open an ETW session and the whole path is dead | Proved live before any module is written; FrameView is the owner's fallback |
| R2 | Anti-cheat in a game treats an ETW consumer as hostile | Palworld single-player has none known; the timedemo path is unaffected either way |
| R3 | A version bump changes the CSV columns under us | The version is recorded in every run's record, and the parser refuses a header it does not recognise rather than misreading a column |
| R4 | The tool ends up in the repository | The `.gitignore` line for `tools/bin/` was written BEFORE the download (the ignore-first rule) |

## 7. Decisions made without the owner

- **Console exe, not the MSI.** He said «ставь» about PresentMon; choosing the 956 KB single-file
  build over the 157 MB installer is the smallest reversible form of that instruction, and it is what
  keeps his own «no third-party GUI» constraint intact.
- **`tools/bin/` inside the repository, git-ignored**, rather than somewhere on the machine: writing
  outside the repository is the destructive class, and a file inside a tracked tree with an ignore
  line is both reversible and visible.
