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
