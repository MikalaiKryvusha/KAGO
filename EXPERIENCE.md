# EXPERIENCE — the agent's accumulated experience

> The agent's growing log of lessons. **Externalized memory of *what works and what doesn't*** — so a
> fresh, context-less session (or an autonomous loop) never repeats a dead end. Consult it BEFORE a task;
> append to it AFTER a meaningful attempt (success **or** failure). Grep, don't scroll.
>
> **Tags live inline on every entry** (not in a central list) — so one grep finds the experiences directly:
> `grep '#loop' EXPERIENCE.md` · `grep -i '#context\|#build' EXPERIENCE.md` · `grep '❌' -A4 EXPERIENCE.md`
> · `grep 'EXP-0007' EXPERIENCE.md`. Reuse an existing tag where one fits (grep to see what's in use).
>
> **Entry format (keep it short and grep-friendly).** Newest on top. Every entry starts with a stable id,
> an ISO date, an outcome marker (`✅` / `❌` / `❌→✅`), and inline `#tags`:
>
> ```
> ### EXP-0001 · 2026-01-01 · ✅ · #tag #area
> **Context:** one line — what was being done.
> **Tried / did:** the approach, briefly.
> **Result:** ✅/❌ — what happened.
> **Lesson:** the reusable takeaway (the reason this entry exists).   → link: bugs/NN · ideas/NN · plans/NN
> **Repro:** the ready-to-run command/check that verifies or applies the lesson — a weak session
>   executes a pasted command reliably, an essay it won't act on. REQUIRED since 2.1: a lesson
>   with no Repro line is not accepted (field-proven: lessons with a Repro command get executed,
>   essay-lessons get read and ignored). If the lesson genuinely has no command, say what to
>   OBSERVE instead — but say it as an action.
> **Trigger:** for class-level lessons — the decision point that must invoke this lesson, as
>   "writing X → run Y" (the lesson names WHERE it applies, instead of hoping to be remembered).
> **Not for:** the lesson's validity range — where it does NOT apply. A documented lesson is still a
>   hypothesis; applied outside its range it kills good ideas.
> ```
>
> **A lesson that repeats is a lesson that failed as text.** When the same class recurs in NEW code
> after its entry was recorded, the journal has proven insufficient — the lesson MUST become
> executable (a linter rule, a guard, a gate), and the entry gains the line
> `mechanized: <the tool>`. Two strikes → a mechanism, never a third reminder.
>
> The `#tags` are **trigger-tags**: before a task, grep by the task's tags and QUOTE the relevant
> lessons in your report (id + one line) — or state "no relevant lessons". An unquoted recall is
> unverifiable; `/fable-judge` checks for this line.
>
> Skill: `/experience` (capture a lesson · recall relevant lessons).

## Entries

### EXP-0018 · 2026-08-10 · ❌→✅ · #measurement #instruments #statistics #causality #baseline
**Context:** measuring the meter's own run-to-run spread at stock, so that phase 2's power delta could legally be called an effect (the owner's rule: «потери нет» is a claim about a DIFFERENCE, and it is illegal while the instrument scatters wider than the effect).
**Tried / did:** captured five identical stock runs, got a 0.67 W spread (0.34 %), and was ready to publish that as the floor. Captured a SECOND independent series of five before doing so.
**Result:** ❌→✅ series B scattered even tighter — 0.49 W — but its MEDIAN sat **0.9 W away from series A's**, further than either series' own width. Pooled over all ten the honest floor is **1.28 W = 0.65 %**, nearly double what one series claimed. Runs inside a series share a thermal state, a background and a warm cache, so their agreement is partly an artefact of that sharing rather than a property of the instrument. Same run also cost me a retracted claim: seeing one hot 201 W run that had started with the fan at 0, I wrote «fan at start → 4 W» into the code comment — series B then produced a run that started with the fan at 0 and landed with the cool group. The real relation was power ↔ the temperature the run REACHES (62–63 °C → 196–197 W; 68 °C → 201 W), and the fan was a bystander.
**Lesson:** **an instrument's scatter measured within ONE series is not its floor — repeat the series, and report the pooled range.** The cheap version of this mistake is invisible: five tight numbers look like proof of precision, and the second series is what turns "my runs agree with each other" into "my instrument agrees with itself across conditions". The second half is the causality rule: **with N=1 for a condition, name the CORRELATION and not the cause** — a co-varying condition (fan, background, order) will happily explain a difference until one more run refutes it, and a cause written into a comment or a doc outlives the data that never supported it. Write what varied WITH the effect, keep the condition in the record, and let the next series decide.   → link: plans/03 §4.4 · automation-engine/lib/power-baseline.mjs
**Repro:** `npm run power -- --capture --workload branchy --seconds 30 --sustain 30 --repeat 5 --label stockA`, then the same with `--label stockB`, then `npm run power -- --spread stockA`, `--spread stockB` and the pooled `--spread stock`. Expect the pooled range to exceed both individual spreads; report the pooled one.
**Trigger:** about to state an instrument's precision, a benchmark's noise floor, or a "no measurable difference" → take a SECOND independent series before quoting the number, and pool them.
**Not for:** measurements whose conditions genuinely cannot drift between series (a pure function timed on fixed input, a checksum), and one-shot observations where no repetition exists — there, say the figure is single-sourced instead of inventing a spread.

### EXP-0017 · 2026-08-10 · ✅ · #verification #measurement #instruments #cross-check
**Context:** building a throughput meter for the GPU — a number that would carry three jobs at once (the owner's price budget, the clock-stretching detector, the memory-replay detector). A number that quietly lies would have been the worst artefact this project could produce.
**Tried / did:** made the program report its OWN duty factor (`gpu_us / wall_us`, from CUDA events inside the process) while a SEPARATE process sampled the card's `utilization.gpu` through `nvidia-smi`. Two readings of the same physical quantity, produced by different code, different clocks and different vendors' instrumentation.
**Result:** ✅ they agreed — 56.3 % vs 57 % for one workload, 98.5 % vs 97 % for the other. That agreement is what made the number trustworthy; without it I would have had a plausible figure and no way to tell plausible from correct. The same run also produced a finding neither instrument could have given alone: saturated, the card draws 194.8 W against a 300 W limit, so the power-limit axis cannot bite on that workload at all.
**Lesson:** **when you build an instrument, look for a SECOND, independently-authored reading of the same quantity, and publish the pair.** Agreement between two instruments is evidence of a different KIND from any amount of care inside one of them — it is the only check that can catch an error shared by your code and your reasoning, because both came out of the same head (the EXP-0012 family: the tests check what you thought to assert). Prefer a second reading that is independent in its AUTHOR, not merely in its code path: our own two functions agreeing proves less than our function agreeing with the vendor's driver. And when they DISAGREE, that is the finding — do not average them.   → link: `researches/04` §2 · `workloads/sdc_fma.cu` · plans/03 §4.3
**Repro:** run the workload with `--sustain N` and read `gpu_us/wall_us` off its own line; run `npm run mon -- --seconds N --out runs/x.jsonl` in a SEPARATE process (in-process records zero samples — `spawnSync` blocks the event loop) and take the median of `utilization.gpu`. The two must land within a few points of each other.
**Trigger:** about to trust a number a new instrument produces → find a second, independently-authored reading of the same quantity before believing it, and print both.
**Not for:** quantities nothing else can observe (there the honest move is to say so and mark the figure single-sourced), and cases where the "second" instrument is just your own code called twice — that is one instrument with two call sites.

### EXP-0016 · 2026-08-10 · ❌→✅ · #verification #guards #mutation #false-green #testing
**Context:** writing `profile-manager.mjs` with a selftest whose whole job is to guard P2-AC2 — «a written value counts as read back only when TWO consecutive samples agree». The suite had a block for it: a fake card that returns the OLD value once, then the new one. 13 blocks, all green.
**Tried / did:** before trusting the green, ran the suite against deliberately broken COPIES of the module — one mutation per load-bearing guarantee. One of them cut the rule from two agreeing samples down to one.
**Result:** ❌→✅ **the single-sample mutation stayed GREEN.** The block I had written to guard the two-sample rule did not guard it: a stale value fails the "does it match the target?" expectation anyway, so the streak counter was never what saved us — the predicate was. The scenario that actually needs a second sample is the opposite one: a card that FLASHES the target value for one read and goes back (physically plausible — a released clock wanders 810…1065 and can brush past the point). Added that fixture; the mutation went red. Same run, second finding: my mutation harness printed «ЗЕЛЁНЫЙ» for a mutation that had CRASHED the process — 0 failures parsed out of a stack trace.
**Lesson:** **a fixture that a NEIGHBOURING rule also catches does not test your rule.** Writing a guard for rule R, ask which single fixture ONLY R can catch, and build that one — otherwise the suite is green for reasons unrelated to R, and it will stay green when R is deleted. The mutation run is the only thing that tells them apart, because both stories agree with the code you just wrote. Corollary, second half: **a crashed verifier is not a green verifier** — parse for the suite's own completion line, never for the absence of failures (`BUG_FIXING_FRAMEWORK.md` → a finding is not a finding, point 3). Extends EXP-0008 from "prove the guard can go red" to "prove it goes red FOR ITS OWN REASON".   → link: `automation-engine/lib/profile-manager.mjs` · plans/03 §4.2
**Repro:** copy the module to a scratch tree with its imports, replace ONE guarantee (`agreeing = READBACK_AGREEING_SAMPLES` → `agreeing = 1`), run the suite, and require both: the completion line PRESENT and at least one block failed. Green or missing completion line = the suite does not guard that line.
**Trigger:** about to trust a new selftest → mutate each guarantee it claims to protect, one at a time, and demand a red that names the block belonging to that guarantee.
**Not for:** suites over pure functions with one obvious assertion per rule — there the fixture cannot help but isolate.

### EXP-0015 · 2026-08-10 · ❌→✅ · #windows #processes #electron #owner-machine #measurement
**Context:** the owner asked for the GPU's background load to be removed — stop NVIDIA Broadcast and LosslessScaling, which held the card awake.
**Tried / did:** enumerated both process trees and stopped every PID, children before the root.
**Result:** ❌→✅ LosslessScaling died and stayed dead; **NVIDIA Broadcast came back with fresh PIDs within two seconds**. The new root's command line named the cause: `--render-crash-relaunch`. Killing a renderer child of an Electron app IS a renderer crash from the app's point of view, and the main process dutifully resurrected itself. Re-run root-first — one `Stop-Process` on the root took the whole six-process tree with it, 0 survivors, nothing to finish off.
**Lesson:** **an Electron/Chromium app must be stopped ROOT FIRST — killing children first triggers its own crash-recovery and it restarts itself.** Generalize past Electron: before concluding "this process resurrects itself / a service is guarding it", read the NEW process's command line — a supervisor names itself there, and the difference between "something is guarding it" and "I made it think it crashed" is one field. The second half is about measurement rather than processes: stopping those two apps bought only **~6 W** and did NOT return the card to its 180 MHz / 21.76 W floor, because the biggest remaining GPU client is `dwm.exe` — the desktop compositor, unstoppable while Windows is displayed on that card. **A quiet desktop is not a reachable state; design measurements as a delta under a dominating load, not as an absence of background.**   → link: `AGENT_GUIDE.md` → the owner's-machine rule · `STATUS.md` (machine state)
**Repro:** `Get-CimInstance Win32_Process -Filter "Name='X.exe'"` → the root is the one whose `ParentProcessId` is NOT in that PID set → `Stop-Process -Id <root> -Force` → re-enumerate. If new PIDs appear, print their `CommandLine` before killing again.
**Trigger:** about to stop a multi-process desktop app (Electron, Chromium, anything with `--type=renderer` children) → stop the root first, and if it comes back, read the new command line instead of killing in a loop.
**Not for:** single-process programs and services — a service is restarted by the SCM and the fix there is the service's start mode, not the kill order.

### EXP-0014 · 2026-08-10 · ❌→✅ · #gpu #write #readback #observation #owner-machine
**Context:** the first GPU write of phase 2 — finding out whether `nvidia-smi -lgc` works on this GeForce and, harder, what can READ THE LOCK BACK, since `nvidia-smi` carries no locked-clocks field: `-q -d CLOCK` answers *"Requested functionality has been deprecated"* for Applications Clocks and has no Locked Clocks section at all.
**Tried / did:** locked the core to an exact point of the measured ladder (`-lgc 1200,1200`), read the state, released with `-rgc`, read the state again immediately.
**Result:** ❌→✅ two findings, one useful and one alarming. USEFUL: the lock IS directly observable and needs no load — the idle clock went 180 → exactly 1200 MHz and stopped moving, so `clocks.gr` is the read-back; `clocks_event_reasons.active` stayed `0x0000000000000000`, so the event mask is NOT the observable and a future session must not reach for it. ALARMING: the read taken immediately after `-rgc` still reported 1200 MHz next to exit 0 and *"All done"* — the release surfaced about a second later, and in that gap my own report read to the owner as "the reset did not work".
**Lesson:** **a GPU write settles ASYNCHRONOUSLY — a single read straight after it can return the PREVIOUS value, and the tool's success text is not evidence either** (`researches/01` §5 already caught the same tool lying in its "from" field). Read-back therefore means *poll until two consecutive samples agree*, never one query. The corollary is the stronger half: a value that stops VARYING proves a lock better than any status field — pinned it was exactly 1200 and constant, released it wandered 810…1065, which a lock cannot produce. And the process half, which is what actually cost something: I ran a state-changing flag without reading its documentation first, and the owner had to say so.   → link: `AGENT_GUIDE.md` → the owner's-machine rule · `researches/01` §5
**Repro:** `node -e "const{execSync}=require('child_process');let p=null,n=0;const t=()=>{const v=execSync('nvidia-smi --query-gpu=clocks.gr --format=csv,noheader').toString().trim();n=(v===p)?n+1:0;p=v;console.log(v,n?'STABLE':'settling');if(!n)setTimeout(t,700)};t()"` — treats a value as read back only when two consecutive samples match.
**Trigger:** about to verify ANY write to the card → poll the written field until two consecutive samples agree; never trust the first read, and never the tool's stdout.
**Not for:** read-only probes, and fields the card reports as pure state rather than as a target it converges toward (driver, VBIOS, the power-limit range) — those answer correctly on the first read.

### EXP-0013 · 2026-08-10 · ✅ · #dry #architecture #drift #pairs
**Context:** phase 1 asked for a truth↔mirror pair — the field list in `researches/03` §2 ↔ the fields `hardware-mon.mjs` samples — to be entered in the registry and watched.
**Tried / did:** did not create the pair. Made the sampler read `config.TELEMETRY_FIELDS` directly, so the second list never came into existence, and wrote into the module a refusal to run if that list ever contains a field probed absent on this card.
**Result:** ✅ nothing to drift, nothing to watch, and the "check" became a property of the code instead of a chore in a table. The registry now holds only pairs that genuinely cannot be collapsed (the card's own throttle names ↔ our bit table; the event schema ↔ the fixtures; the live driver ↔ every baseline stamp).
**Lesson:** **a pair you can DELETE beats a pair you must WATCH.** When a plan says "register this pair", ask first whether one side can simply read the other — a registry row is maintenance forever, a shared constant is maintenance once. Register only what has two genuinely independent authors (a vendor's output, a captured fixture, a stamp taken at a past moment). The registry is for drift you cannot design away, not for duplication you chose.   → link: plans/02_epic01_phase1 §3.9 · AGENT_GUIDE.md (pairs registry)
**Repro:** before adding a registry row, run `grep -rn "<the duplicated list>" --include=*.mjs .` — if both sides are ours and in one language, import one from the other and delete the row.
**Trigger:** about to write a row into the truth↔mirror registry → check whether one side can import the other instead.
**Not for:** pairs whose sides are authored by different parties (a vendor's field names, an owner's document, a captured golden) — those are real pairs and deleting one side is not an option.

### EXP-0012 · 2026-08-10 · ❌→✅ · #verification #output #observation
**Context:** building the phase-1 harness — three modules, each fully unit-checked and green.
**Tried / did:** after each one, READ ITS PRINTED OUTPUT line by line instead of only reading the code and the test results.
**Result:** ❌→✅ that reading found three defects the tests could not: `--since 2026-07-01` printed «ОКНО: 2026-07-01T**03:00**» (a bare date is UTC midnight by spec, cutting three hours off every fault window on +03:00); a captured baseline was stamped `2026-08-09T21:52Z` while the owner's clock read `2026-08-10 00:52`, i.e. a receipt dated the PREVIOUS DAY; and a transient run's own telemetry showed the load peaking at 30 %, not the saturation the design assumed.
**Lesson:** **the tests check what you thought to assert; the OUTPUT shows what you actually built.** A green suite and correct-looking code agree with each other because they came from the same head — the printed artifact is the first thing in the loop that does not. So after any tool starts working, spend one minute reading its output as a STRANGER would: every number, every timestamp, every unit. Timezone, unit and off-by-one defects live almost exclusively there, and none of them will ever fail a test you would have written.   → link: plans/02_epic01_phase1 §3.5, §3.7
**Repro:** run the tool for real, then for each printed number ask "is this the number I would expect if I knew nothing about the code?" — compare timestamps against `date`, ranges against the source, units against the field name.
**Trigger:** a new tool's tests just went green → run it for real and read every line of its output before calling it done.
**Not for:** pure libraries with no human-facing output — there the tests genuinely are the surface.

### EXP-0011 · 2026-08-10 · ❌→✅ · #verification #oracle #false-positive #baseline
**Context:** the first real run of `stress-tester.mjs` against a golden reference, with a heavier burst (`--arg 4000000`) than the one the baseline was captured with.
**Tried / did:** compared the run's checksum against the golden's checksum — the obvious comparison, and the one the plan describes.
**Result:** ❌→✅ «ТИХОЕ ИСКАЖЕНИЕ ДАННЫХ: 58 из 58 прогонов разошлись с эталоном». Nothing was corrupted: the checksum is a function of the run parameters, so the comparison had never been valid. Fixed by making the run ARGUMENTS part of the golden's stamp alongside driver and VBIOS, and by returning UNKNOWN — not a verdict — whenever any stamp field differs.
**Lesson:** **a reference records a VALUE; a stamp records the CONDITIONS under which that value is true — and a comparison across differing conditions has no verdict, not a negative one.** The instinct is to treat a mismatch as a finding; here the mismatch was an artefact of the setup, and a FALSE positive from an oracle is worse than a missed one: a voltage sweep would have declared a healthy card unstable at every point and "found" a Vmin that does not exist. Whenever you store a golden, store everything the value depends on, and make the checker refuse rather than guess.   → link: plans/02_epic01_phase1 §3.6 · automation-engine/lib/stress-tester.mjs
**Repro:** `npm run stress -- --workload sdc_fma --seconds 3 --arg 4000000` against a default-args baseline → must print НЕИЗВЕСТНО with the reason, never SDC.
**Trigger:** writing or comparing against any golden/reference/snapshot → list what the stored value depends on, and put every item into the stamp the checker verifies first.
**Not for:** comparisons whose conditions are fixed by construction (a pure function's output over a literal input) — there the value alone is the whole truth.

### EXP-0010 · 2026-08-10 · ❌→✅ · #tooling #reading #encoding #false-lead
**Context:** fixing the markdown renderer in `tools/lib/review-core.mjs`; the Read tool showed the fence placeholder as `` ` FENCE${i} ` `` — a space, the token, a space.
**Tried / did:** wrote an Edit whose `old_string` quoted that line verbatim from the Read output.
**Result:** ❌→✅ the edit did not match, and Grep then answered `binary file matches (found "\0" byte)`. The delimiters were **NUL bytes**, which Read renders as spaces. The code was fine; my copy of it was not. Patched the span with a Node script using explicit ` ` escapes instead.
**Lesson:** **an unmatched Edit is evidence about the READER, not about the file.** Read is faithful for text but silently renders control bytes as printable ones, so a byte-exact operation built from its output can be wrong in a way nothing announces. Same family as EXP-0007 (Grep) and EXP-0004 (`pdftotext` exiting 0) — the instrument lies, the artifact is innocent. When an Edit fails on a string you just read: dump the bytes before re-reading the prose.   → link: bugs/01 · tools/lib/review-core.mjs
**Repro:** `node -e "const b=require('fs').readFileSync(F); console.log([...b].filter(x=>x<9).length)"` — any count above zero means the file holds control bytes your reader is not showing you; patch such spans with a script, never by hand.
**Trigger:** an Edit fails on a string copied straight out of Read → check the span for control bytes before assuming the file changed under you.
**Not for:** ordinary mismatches from stale context — re-read first; this entry is about a span you read moments ago.

### EXP-0009 · 2026-08-10 · ❌→✅ · #bugs #inventory #review #verification
**Context:** picking up `bugs/01`, a document filed by a previous session summarizing an adversarial review of the owner-review contour.
**Tried / did:** started from the document's own list — "23 findings, 8 major" — intending to fix by it. Before fixing, went looking for the workflow journal the document cited as holding "the rest".
**Result:** ❌→✅ the journal was still on disk and held **71 raw findings, 54 distinct after dedupe, 6 of them blockers** — and 14 against a source file the bug document listed nothing for. The distillation had dropped an entire severity class and an entire artifact.
**Lesson:** **a bug document written as a SUMMARY is not an inventory, and the framework's "judged by the list" is empty when the list is a précis.** A session that distils a review into prose is choosing what the next session will never fix. So: before working a filed bug, open its cited primary source and rebuild the list mechanically; and when filing one, put the machine-generated inventory IN the document, because the source (a workflow journal, a scratch run) is session-scoped and dies with the chat.   → link: bugs/01
**Repro:** the journal lives at `~/.claude/projects/<project>/<session>/subagents/workflows/<wf-id>/journal.jsonl`; `find "$HOME/.claude" -name journal.jsonl -path "*<wf-id>*"` finds it, and each `{"type":"result"}` line carries one reviewer's structured findings.
**Trigger:** a bug document cites an external source for "the rest of the findings" → read that source and rebuild the list before fixing anything.
**Not for:** bugs whose document already carries a countable, machine-generated list — there the list IS the source.

### EXP-0008 · 2026-08-10 · ✅ · #verification #guards #testing #false-green
**Context:** fixing fifteen findings in the owner-review contour and writing `tools/verify-review-contour.mjs` as their guard.
**Tried / did:** instead of reasoning that each new check would have caught the old defect, ran the *new* check file against the *old* code: `git archive HEAD tools .gitignore package.json | tar -x -C <tmp>`, copied the new verify file into that tree, ran it there.
**Result:** ✅ 12 of 13 blocks went red on `HEAD`, which is the evidence the fixes are real. It also caught two of my own defects that reasoning had missed: one block that passed on the broken version (a lazy `([\s\S]*?)</span>` stopped at a nested span) and a `--only` filter that silently selected nothing for a mixed-case id and exited 0.
**Lesson:** **the cheapest way to prove a guard can fail is to run it against the previous commit — and it costs one command, not a mutation branch.** "This check would have caught it" is an inference; a red run is an observation, and the two disagree often enough that the inference is worthless. The corollary bites hardest on the person writing the checks: a test authored *after* the fix is written against the code in front of you, which is exactly the code it cannot judge.   → link: bugs/01 · tools/verify-review-contour.mjs
**Repro:** `mkdir -p /tmp/old && git archive HEAD tools | tar -x -C /tmp/old && cp tools/<new-verify>.mjs /tmp/old/tools/ && (cd /tmp/old && node tools/<new-verify>.mjs)` — every block that stays green there is a block that proves nothing.
**Trigger:** about to claim a fix is verified by a new test → run that test against `HEAD` first and expect red.
**Not for:** checks for behaviour that never existed before (a brand-new feature has no old version to redden against) — there, prove the check on a deliberately broken copy instead.

### EXP-0007 · 2026-08-09 · ❌→✅ · #tooling #reading #verification #false-lead
**Context:** reviewing code written by subagents — reading `tools/questions-guard.mjs` and `tools/review.mjs` through the Grep tool's content output.
**Tried / did:** read Grep's `-C` context lines as if they were the file's bytes, and started diagnosing two "syntax defects": comment lines beginning `\ T9:` instead of `// T9:`, and a Windows fallback spawning `cmd.exe` with `'\c'` instead of `'/c'`.
**Result:** ❌→✅ both were phantoms. `node --check` passed all along, and opening the same lines with Read showed correct `//` and `'/c'`. Grep's rendering is not byte-faithful for slashes and backslashes in context lines; twice in one session it nearly sent me fixing code that was already right.
**Lesson:** **Grep locates, Read verifies.** Never conclude anything about EXACT CHARACTERS — slashes, escapes, quotes, invisible bytes — from a search tool's context output; re-open the span with Read before believing a syntax defect exists. The cheap tell is a contradiction between two instruments: if the parser says the file is fine and your eyes say it is broken, suspect the eyes' transport first. Same family as EXP-0004 (a tool exiting 0 while silently dropping characters) — the instrument, not the artifact, is the thing lying.   → link: tools/review.mjs · tools/questions-guard.mjs
**Repro:** `node --check <file>` first; if it passes, any "syntax defect" you think you see came from your reader — confirm with `Read` on the exact line range before editing.
**Trigger:** about to fix a syntax-level defect spotted in grep/search output → run `node --check` and re-read the span with Read first.
**Not for:** semantic review — grep output is perfectly good for finding WHERE something is, and for reading prose, names and structure.

### EXP-0006 · 2026-08-09 · ❌→✅ · #canon #rules #language #kaif #audience
**Context:** first `/plan-epic` run in this deployment produced the epic meta-plan in English, in a project whose working language is Russian.
**Tried / did:** followed the canon's *Languages* section literally — it routes by file and directory, and `plans/` sits on the English side.
**Result:** ❌ the owner had to notice it himself. Three lines earlier the SAME file says the meta-plan is "where the owner sees the whole shape once" — the guide contradicted itself, and following one half of it broke the other.
**Lesson:** **a rule written as a LIST cannot govern artifacts created after the list was written.** Skills mint new documents for months; any enumeration made at install time is stale by construction. Express such a rule as a QUESTION the agent can ask about any future artifact — here, *"does the owner read this?"* — and keep the list only as examples under the question. Generalize past language: the same failure shape hits any canon rule phrased as "these files are X" (which dirs are gitignored, which docs need provenance marks, which outputs must be deterministic).   → link: bugs/KAIF/03 · KAIF#6
**Repro:** when you meet a canon rule phrased as a list of files or directories, ask what property the list is a proxy for, then check the newest artifact in the project against the PROPERTY, not the list: `ls -t plans/ interviews/ researches/ | head -5` and route each by audience.
**Trigger:** writing a new document into a knowledge directory → ask "who reads this?" and pick the language from the answer, never from the directory it lands in.
**Not for:** rules whose set genuinely is closed and small (the three root key documents, the `.kaif/` machinery) — there a list is honest and cheaper than a question.

### EXP-0005 · 2026-08-09 · ❌ · #winget #windows #tooling #machine-mutation #probe
**Context:** probing the toolchain for KAGO's epic — wanted to know whether Visual Studio had an update available before writing the fact into the environment dossier.
**Tried / did:** `winget upgrade --id Microsoft.VisualStudio.2022.Community`, believing `winget upgrade` with an id *reports* on that package the way the bare `winget upgrade` lists packages.
**Result:** ❌ it **performed** the upgrade. A VS installer started on the owner's machine at 22:21:07 and replaced MSVC toolset 14.40 with 14.44 mid-session. Symptom seen first, cause understood second: `cl.exe` and `vcvars64.bat` vanished *between two probes minutes apart*, and the contradictory readings looked like a sandbox artefact until the `dd_setup_*` logs and a live `msiexec` named the real cause.
**Lesson:** in winget, **the query verb and the action verb are the same word** — bare `winget upgrade` lists, `winget upgrade --id X` installs. The read-only form is `winget list --id X --upgrade-available` (or `winget show`). Generalize past winget: before running any package-manager verb against a *named* package, ask which of list/install it is — an "am I up to date?" probe must never be able to install. A machine mutation the owner did not authorize is the failure here, not the newer compiler.   → link: researches/03 · AGENT_GUIDE.md (environment dossier)
**Repro:** read-only check — `winget list --id <PackageId> --upgrade-available` (prints the row, changes nothing). Verify a mutation is NOT in flight before trusting any filesystem probe of that package: `Get-CimInstance Win32_Process -Filter "Name='msiexec.exe'"` plus `Get-ChildItem $env:TEMP -Filter dd_*.log | Sort LastWriteTime -Desc | Select -First 3`.
**Trigger:** about to run a package manager against a named package (`winget` / `choco` / `npm i -g`) to LEARN something → use the list/show form, and if the verb could install, ask the owner first.
**Not for:** cases where the owner asked for the upgrade — then the action verb is the point. The owner's ask here was "update **if needed**", and "if needed" was exactly the question I destroyed by answering it with the action.

### EXP-0004 · 2026-08-09 · ❌→✅ · #pdf #encoding #tooling #windows
**Context:** reading the owner's `RTX_5070Ti_Undervolting_Master_Plan.pdf` — the project's source brief, written in Russian.
**Tried / did:** `pdftotext -layout` (present at `/mingw64/bin`). It exited 0 and produced a plausible-looking 167-line file.
**Result:** ❌ then ✅ — the output was silently **missing every Cyrillic character**; only ASCII, numbers and LaTeX fragments survived, so the document read as a skeleton with holes. The PDF's fonts are subsetted `Identity-H` with no usable ToUnicode map. PyMuPDF extracted all 2 813 Cyrillic characters correctly.
**Lesson:** a PDF extractor that exits 0 has not told you it succeeded. On a non-English PDF, **count the non-ASCII characters before trusting the text** — a silent drop looks exactly like a document that had nothing there. Same failure class as the shell-eats-backticks rake in `AGENT_GUIDE.md`: exit code 0, holes in the content.   → link: researches/01
**Repro:** `python -c "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); t=''.join(p.get_text() for p in d); print('cyrillic:', sum(1 for c in t if 'Ѐ'<=c<='ӿ'))" file.pdf` — zero on a Russian document means the extraction failed, whatever the exit code said.
**Trigger:** extracting text from any non-English PDF → count non-ASCII in the result before reading it as truth.
**Not for:** English-only PDFs, and PDFs with proper embedded ToUnicode maps — `pdftotext` is fine there and faster.

### EXP-0003 · 2026-08-09 · ✅ · #tooling #python #windows
**Context:** needed PyMuPDF to extract the PDF above.
**Tried / did:** `python -m pip install pymupdf` on the PATH-default Python 3.14.
**Result:** ❌ `No module named pip` — then ✅ on the second interpreter, Python 3.10 at `%LOCALAPPDATA%\Programs\Python\Python310`, which carries pip 24.2.
**Lesson:** this machine has two Pythons and **only the 3.10 one can install packages**. Reach for it by full path rather than rediscovering the failure.   → link: AGENT_GUIDE.md (environment dossier)
**Repro:** `"/c/Users/krinik/AppData/Local/Programs/Python/Python310/python.exe" -m pip install <pkg>`
**Trigger:** any `pip install` on this machine → use the 3.10 path, not bare `python`.
**Not for:** running scripts that need no third-party package — bare `python` is fine for those.

### EXP-0002 · 2026-08-09 · ✅ · #kaif #deployment #gates
**Context:** closing the `placeholders` item of the KAIF adaptation task.
**Tried / did:** filled every `<PLACEHOLDER>` in `AGENT_GUIDE.md` and in the `.claude/skills/` canon, re-synced the mirrors, then ran the checkpoint.
**Result:** ❌ refused — one `<BUILD_COMMAND>` survived in `.kaif/spheres/programming.md`. The sphere *library* carries template slots, and nothing in the task item's list of locations points there.
**Lesson:** the placeholder gate scans the **whole tree**, not the locations the task item enumerates. Grep before running the checkpoint instead of trusting the item's list.   → link: reports/KAIF_UPDATES/KAGO_KAIF_2.2_INSTALL_REPORT.md
**Repro:** `grep -rn "BUILD_COMMAND\|TEST_HARNESS\|YOUR AGENT" --include="*.md" . | grep -v "^./.kaif/install/"` — must print nothing before `checkpoint placeholders`.
**Trigger:** running any KAIF checkpoint that executes a gate → run the gate's own grep first.
**Not for:** `.kaif/install/` — that is the bundle being installed from, and its placeholders are the source templates.

### EXP-0001 · 2026-01-01 · ✅ · #example #meta
**Context:** first task after KAIF was deployed into this project (example entry — replace with real ones).
**Tried / did:** wrote the first real lesson here in the canonical format.
**Result:** ✅ — the experience log is live and greppable.
**Lesson:** capture lessons at the level of *approach* (what worked / what to avoid), not defect detail
(that lives in `bugs/`); one short entry beats a long story.   → link: (none)
