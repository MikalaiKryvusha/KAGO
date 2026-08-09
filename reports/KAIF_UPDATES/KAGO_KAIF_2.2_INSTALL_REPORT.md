# KAGO — KAIF 2.2 field install report

> **Deployment:** KAIF 2.2 into `KAGO` (a fresh, code-free project) · **Date:** 2026-08-09
> **Agent:** Claude Opus 5 (1M context), VS Code CLI · **Host:** Windows 11 Pro 10.0.26200, Node v24.15.0
> **Parameters:** `--lang ru` · mode standard · agents `claude-code,codex,grok-build,cline,zoo-code`
> **Status:** LOCAL. Not sent upstream; sending is the owner's call.

---

## 1. Chronology with numbers

| Step | Result |
|---|---|
| `node -v` | v24.15.0 — gate passed on the first try |
| `KAIF-LOADER.mjs` written verbatim from the thin `KAIF.md` | 82 lines, one file |
| `node KAIF-LOADER.mjs --lang ru` | **exit 0** |
| Artefacts fetched from `releases/latest/download` | `KAIF-CORE.mjs` 173 265 B · `KAIF-CORE-BUNDLE.md` 794 062 B — both sha256 ok |
| Files deployed by the machinery | 246 written · 1 kept (`GOAL.md`, pre-existing) · `.gitignore` seeded ignore-first · `kaif:*` handles wired into `package.json` |
| Skills | 35, mirrored to 5 agent systems (152 mirror copies re-synced twice during adaptation) |
| `ru` language pack | 8 owner docs localized; 15 documents + all 35 skill bodies arrived in English by design |
| Adaptation task | 9 items, all checkpoints recorded |
| Placeholder gate | **refused once**, passed on the second run |
| `verify-final` | see §4 |

**Time to a working deployment:** the mechanical half was a single command. Everything after it was
cognition, and cognition was where the hours went — two research documents, two maps, a master plan.

## 2. Friction and rakes

### 2.1. The placeholder gate scans wider than the task item lists — CONFIRMED

The adaptation item enumerates the locations of every placeholder:

> `<BUILD_COMMAND>` → AGENT_GUIDE.md, .claude/skills/autoloop/SKILL.md, .claude/skills/dayloop/SKILL.md, .claude/skills/nightloop/SKILL.md

Those four were filled. The checkpoint still refused:

```
✖ placeholder <BUILD_COMMAND> still in .kaif/spheres/programming.md
✖ checkpoint placeholders REFUSED: 1 literal placeholder(s) remain on disk
```

`.kaif/spheres/programming.md:17` carries `| build | compiling/packaging the product (\`<BUILD_COMMAND>\`) |`.
The sphere library is not in the item's list, and `kaif-core.mjs:1362` even carries a comment
calling sphere-library slots template slots **by design** — yet the gate counts them.

**Cost:** one failed checkpoint, ~3 minutes. **Not severe** — the gate names the file, so recovery
is immediate. **Suggested fix:** the task item should either list `.kaif/spheres/<sphere>.md` among
the locations, or the gate should exempt the sphere library it deliberately templated.
*Classified as an improvement request (template B), not a bug: nothing broke and the message was
actionable.*

### 2.2. The `ru` language pack's honesty is a feature, and it reads as a wall

The install printed one 5-line paragraph naming 15 documents plus "all 35 skill bodies" that arrive
in English. The message is accurate and the design is defensible (English-first for the model's
sake) — but arriving as an unbroken run-on immediately after the sha256 lines, it reads as a
warning about something having gone wrong. It has not. **Suggested improvement:** split the notice
into "localized: N" and "English by design: N" with the list behind a count.

### 2.3. Nothing else broke

No network retries, no sha256 mismatch, no bare-run accident, no file the machinery refused to
write. The self-cleaning behaviour and the `checkpoint` mechanics did exactly what the thin
`KAIF.md` said they would.

## 3. What confused a cold agent — top 3

1. **Which document wins when two owner sources disagree.** The owner's PDF names MSI Afterburner
   as the profile applier; `GOAL.md` forbids a third-party GUI dependency. Both are the owner's
   word. The canon covers owner-vs-agent disagreement thoroughly and says little about
   owner-vs-owner. Resolved here by treating the later, more specific statement as governing and
   recording the supersession in a research doc — but that was a judgement call, and a weaker
   session would plausibly have implemented the PDF.
2. **`MASTER_PLAN.md`'s language is genuinely ambiguous.** The language split names `GOAL.md`,
   `KAIF_FRAMEWORK.md` and the directory READMEs as owner-facing (so Russian), and the maps and
   `STATUS.md` as agent-internal (so English). `MASTER_PLAN.md` appears in the re-read core *and* in
   the "arrives in English" list, while being the one document an owner steers by. Written in
   Russian here on that reasoning; the canon does not settle it.
3. **The adaptation task forbids editing itself, which collides with the habit of ticking boxes.**
   The instruction is explicit and correct, and the `checkpoint` command is the right mechanism —
   but the file still renders as a checklist with checkboxes, which is exactly the affordance the
   instruction tells you not to use.

**Not confusing, and worth saying so:** the three-step bootstrap with forced `KAIF-BOOT:` lines is
unusually hard to get wrong. The verbatim-file rule ("the label is law") removed every temptation to
improvise.

## 4. Final state and judge verdict

Adaptation checkpoints recorded: `study` · `project-name` · `placeholders` · `maps` · `goal-plan` ·
`sphere` · `kaif-framework` · `field-report` · `verify`.

**What the deployment produced beyond the mechanical unpack** — the part a report should be judged on:

| Artefact | Evidence it is real, not claimed |
|---|---|
| `researches/01_gpu_control_paths.md` | Answers the owner's open question. Every hardware number is `nvidia-smi` output quoted in §2 of that doc. |
| `researches/02_vmin_guardband_methodology.md` | Numbers taken from Leng et al. (MICRO 2015) via extracted PDF text, not recall. |
| `tools/check.mjs` | `npm run check` → `checked 3 .mjs file(s), 0 failed`, exit 0 |
| `tools/gpu-info.mjs` | `npm run gpu:info` → correct card, driver 610.88, power range 250–300 W, exit 0 |
| `AGENT_GUIDE.md` environment dossier | 7 of 11 rows probed; the remaining 4 carry `— not probed yet —` rather than invented values |

**Judge pass — claims checked against evidence:**

- ✅ *"KAIF 2.2 is deployed"* — `.kaif/kaif.json` marker present, 246 files on disk, `verify-final` run.
- ✅ *"the placeholders are filled"* — the gate executed its own scan and passed; independently
  re-grepped across the tree.
- ✅ *"the two tools work"* — both were RUN, and their output is quoted above rather than described.
- ⚠️ *"the project is ready for phase 1"* — true for documents, and the code is zero lines. `STATUS.md`
  says so plainly; this report repeats it so no reader infers a working orchestrator.
- ⚠️ **One requirement is knowingly unmet and named:** `GOAL.md` asks that killing the tray icon
  reset the GPU. A process killed by Task Manager runs no exit handler, so the mechanism does not
  exist yet. Recorded as an open joint in `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §4 rather than
  quietly deferred.
- ⚠️ **No GPU write was performed.** `nvidia-smi -pl` support is *implied* by the reported 250–300 W
  range, not observed. The distinction is preserved everywhere it appears.

**Verdict: install GREEN, adaptation GREEN, product NOT STARTED.** The framework did its job — the
one gate that fired, fired correctly and named its file.
