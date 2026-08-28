---
name: release
description: Build a release candidate and publish it to GitHub Releases — pre-check, refresh README (and bilingual copies), regenerate rendered docs, version bump + build + tag + push + GitHub Release. Use when the human says "make a release", "ship a release", "cut an RC", "publish a new version", "release", "ship it", "сделай релиз", "выпусти релиз". Trigger aliases (ru): «сделай релиз», «выпусти релиз», «опубликуй новую версию», «отгружай»
---

# /release — publish a release to GitHub

The human asks to ship a new version. This is an **irreversible external action** (a public tag +
GitHub Release). Run the routine **in order**; narrate each step in the chat. If a step fails — stop,
show the error, do NOT continue blindly.

> ⚠️ **CONFIRMATION REQUIRED.** Before the publish itself, show the human: which version it'll be
> (current → new), that the tree is clean, that it built. Publish only on their explicit "yes". A release
> = a public tag and Release, unpleasant to roll back. **In autonomous mode (`/autoloop`/loops) do NOT
> publish a release.**

## Step 0. Decide the bump type and the codename (an IDENTITY stop, not a formality)

Confirm with the human (or confirm the default): patch / minor / major. State the current → new version.

**Every release normally gets a short codename** (a memorable one- or two-word name for the theme, e.g.
*Anonymous*, *Slim*, *Savvied*). The codename drives the release **title** and headline — see Step 6.

**The codename is IDENTITY, and identity is authored by the owner — never by the agent, under ANY
breadth of approval.** A blanket "ship it, don't ask me" removes confirmation FRICTION on actions;
it does not transfer AUTHORSHIP of how the product presents itself (field incident: under a literal
"I APPROVE EVERYTHING, don't ask" an agent invented a release codename, and the owner met their
product's name as a fait accompli). This hard stop has exactly three legal outcomes:

1. **the owner names it** (or picks from candidates you offer);
2. **you do EVERYTHING else and ask ONE pointed question about the name** — one question inside
   already-authorized work costs nothing and is not what "don't ask" was about;
3. **release UNNAMED** under the neutral factual title (`<PROJECT> X.Y`) — the ALWAYS-AVAILABLE
   fallback: when the owner is unreachable, the release is never blocked forever, and only the
   owner may name it, retroactively if need be. Never a placeholder name: a placeholder is still a
   name someone must later un-decide.

**The shipped name carries a SOURCE artifact** — a line in the release notes/plan:
`codename: <owner · channel · date>` — the way a research claim carries its citation; a name
without an author must be impossible to miss. And if a shipped name proves wrong, the agent does
not rename on its own initiative — fixing a brand mistake is a brand decision too.

## Step 1. Pre-check the environment (don't release on a dirty/broken tree)

```bash
git status --short          # tree must be CLEAN (except gitignored artifacts)
git branch --show-current   # the release branch (e.g. main)
git pull --rebase           # so the push is fast-forward
gh auth status              # gh logged in (needed for the GitHub Release)
```
If the tree is dirty — commit/sort it out first (`/pause` or your commit tool).

If the project keeps a **truth↔mirror pairs registry** (`AGENT_GUIDE.md` → Document & text
hygiene), run every row's check command now — a release shipped over a drifted pair pins the drift
into the delivery. Red row = stop and reconcile before proceeding.

## Step 2. Refresh README (all languages)

Bring `README.md` in line with reality: phase status, working features, instructions. If bilingual, keep
both languages in sync. Don't invent — reflect only what's actually done and verified (cross-check
`STATUS.md` and the closed `bugs/`/`ideas/` `*_DONE_*`).

**The version number also lives INSIDE images — regenerate them with a command, not by eye.** A
showcase carries its version in places no text search reaches: a caption burned into a logo or a
banner, plus the badge, the version line, the image alt text and the newest row of the version
history table. List those places once, give each a command, and run them here:

```bash
<your command that redraws the versioned image, e.g. node tools/build-logo-title.mjs>
```

Then OPEN the image and read the caption — a render is judged by eyes. Paid for in the field on
this framework's own origin: release 2.3 shipped to GitHub carrying a logo that still said
version 2.2, and a README still on the previous version, because nothing could redraw the caption
and nobody opened it.

**And the MEANING of a code name is asked of the owner, never derived from the name itself.** If
the showcase explains what the version's name means, quote the owner's word for that meaning (an
interview, the decision journal, a chat message). No such word — either ask one pointed question
or don't explain the name at all; a neutral framing is legitimate. Paid for in the same session: a
name was read as a plausible-sounding metaphor, and the guess spread through both language halves
of the release notes as paragraphs and headings while every showcase guard stayed green.

**The README and the release notes are the OWNER'S artifacts — the showcase they sign.** So if the
project has a voice portrait (`AUTHOR_STYLOMETRY.md`, `/owner-voice`), OPEN it now and run its
self-check before handing the text over; no portrait, no obligation, and its absence never reddens
the release. A DRAFT portrait (thresholds unmet, no blind test passed) is written BY, never rewritten
FROM: rewrite mode does not start from a draft. Either way the verdict "this sounds like me" belongs
to the owner — the taste class is never judged by the agent (`TESTING_FRAMEWORK.md`).

**Being the owner's artifacts does NOT put provenance marks into them** (`AGENT_GUIDE.md` →
provenance marks, the showcase exemption): `README` and the release notes ship as-is, so they never
carry `[AI]…[/AI]`. Their acceptance queue is the owner's PROOFREADING, and it is just as mandatory —
file the request as homework and say plainly, in the release report, that the showcase text is not
yet proofread if it is not.

**The showcase is judged by a MACHINE, not by memory.** The storefront rules live in
`AGENT_GUIDE.md` → "The storefront — text a stranger reads": no text about the document itself, no
excuses next to a number, no hint of a backstage, no denial undermining a figure, no calque, no
impersonal voice in a procedure, no internal label as a table row name, no estimate range wider
than its source, no internal build command shown as proof, no instruction the human cannot execute
(a flag the AGENT passes is not something the reader can "add"), and the two language halves must
match in skeleton. `<If the project has a storefront linter, run it here; otherwise walk the ten
rules by hand before handing the text over.>`

## Step 3. Regenerate rendered docs

`<Regenerate any rendered artifacts, e.g. README.pdf (node tools/readme-pdf.mjs). For this framework's
own project, also regenerate the self-extracting core: node tools/build-framework.mjs.>`

## Step 4. Control build (before the release)

`<Run the project build (`npm run check`). It must succeed. This catches errors BEFORE the version bump so
you don't leave a half-released version.>`

## Step 4.5. Judge pass — MANDATORY adversarial verification before publishing

Run `/fable-judge` over the release candidate's own claims: every statement in the README/notes about
what works is re-run or re-opened (build, self-checks, artifact list, versions, links), and the change
set is diffed against the release's declared scope. The verdict must be **VERIFIED**, or **VERIFIED WITH
CAVEATS** with every caveat explicitly carried into the release notes. **REFUTED blocks the release** —
fix and re-judge before proceeding. (A release is the one artifact whose false claims the whole world
downloads.)

## Step 5. Commit the doc/build changes (before the release)

Commit the README/docs updates so the `release: X.Y` commit is a clean version bump: run
`git add -A && git commit -m "<msg>" && git push` with `<msg>` = `docs: README for release X.Y`.

## Step 6. Publish (after the human's confirmation)

`<Run your release flow. If you have a release tool (e.g. tools/release.mjs that bumps the version,
builds, renames the artifact, commits "release: X.Y", tags vX.Y, pushes, and runs gh release create),
run it. Otherwise, do it explicitly:>`
```bash
# bump version (in version.json or your manifest), then:
git commit -am "release: X.Y" && git tag vX.Y && git push && git push --tags
gh release create vX.Y --title "<PROJECT> X.Y — <Codename>" --notes-file <NOTES.md> <ARTIFACT(S) if any>
```

> 📛 **Release title — FIXED FORMAT (CANON):** `<PROJECT> X.Y — <Codename>` — the project name, the
> `major.minor` version, an em dash `—`, then the Step-0 codename. Examples: `KAIF 1.2 — Anonymous KAIF`,
> `KAIF 1.3 — Slim KAIF`, `KAIF 1.4 — Savvied KAIF`. On Step 0's legal UNNAMED outcome the title is the
> neutral `<PROJECT> X.Y` — factual, no invented name. **Not** `vX.Y`, no guillemets, no quotes. Keep it
> consistent with every prior release (check `gh release list`).
>
> 📝 **Release notes — the DELTA, never a README copy (do NOT `--generate-notes`).** Notes answer ONE
> question: *"what changed in THIS version, and should I upgrade?"* — strictly this version's delta;
> anything that describes the product in general is LINKED to the README, never copied (field
> incident: 34 KB of notes turned out to be a near-copy of the README; rewritten by the delta —
> 12 KB, not one fact lost). The mechanical scope check before publishing: **a paragraph you could
> paste into the README unchanged belongs in the README, not in the notes.**
> **Different documents draw from different wells:** notes take their shape from THIS project's
> PREVIOUS release notes (`gh release view <prev> --json body -q .body` — follow the house style);
> the README takes its shape from the current README and the owner's other repo storefronts. Mirror
> **every language the README ships in**, with in-page anchors/toggles. Structure per language: a
> header line (release date · place), a one-paragraph "what this release is", the attached
> artifacts, a **✨ What's new** section (the delta), an **⬆️ Upgrading** note when relevant, and a
> LINK to the README for what the product is and how to start. Write the notes to a file and pass
> `--notes-file`.

## Step 6.5. The deploy checklist (when shipping replaces a RUNNING system)

If this release includes deploying over a live server/container/service, walk five gates — each exists
because skipping it took down a real prod:

1. **Deploy mirror first.** Capture the ACTUAL configuration of the running prod BEFORE replacing it
   (inspect/env/version) — prod often lives with settings no document remembers, and a blind redeploy
   "by the docs" silently changes behavior (or points prod at a dev emulator). Every difference between
   the old run and the new one must be a conscious, named decision.
2. **Live smoke.** Start the new instance and read its first working cycle in the log with your eyes
   (`TESTING_FRAMEWORK.md` → observation gates).
3. **Artifact self-sufficiency.** The image/bundle starts in isolation, all modules present — an image
   that lagged behind the code has downed prods with every test green.
4. **Domain invariants.** Before the switch, write down the numbers that must not change (counts, sums,
   sizes); after it, compare them.
5. **Prod-run document.** After the deploy, update the repo's "production run" document — the single
   source of truth for how prod is actually launched. A prod config living only inside a running
   process is a mine the next session steps on.

## Step 6.9. PUBLICATION GATE — open the rendered page and read the first screen WITH YOUR EYES

Checking the SOURCE is not checking the PUBLICATION. Rendering rules belong to the foreign medium,
and they differ: **a GitHub release body preserves single line breaks** (a 100-column wrap becomes
ragged text), **a README joins them**, **a PDF re-flows to its own width**. Field case: a release
page shipped with a conjunction hanging alone on a line and a sentence cut in half, while the
source file had passed four green tools — the defect arrived as a screenshot from the owner.

```bash
gh release view vX.Y --web   # open the PUBLISHED page, not the notes file
```
Read the first screen: paragraphs intact, breaks where you intended them, image in place, links
clickable. The mechanical half of the gate runs before publishing: the notes body file must have
**no two non-empty lines in a row** outside code blocks and tables.

The rule is wider than releases and applies to any foreign medium — an issue, an email, a chat bot,
a slide: learn its wrapping rule BEFORE writing, open the result AFTER shipping.

## Step 7. Verify and report

```bash
gh release view vX.Y        # the release exists, artifacts attached
git log --oneline -3        # the release commit + tag are visible
```
Report to the human: the version, the release link, what was attached. Done.

## Notes
- Releases bump minor/major; ordinary in-progress commits bump the build/patch.
- If the push is rejected (non-fast-forward) — `git pull --rebase` and retry. On step 6 this is critical:
  a tag may already exist locally — check `git tag` and `git tag -d vX.Y` before retrying.
- NEVER force-push and never delete others' tags/releases. If something goes wrong during publish — stop
  and show the human, don't "fix" it blindly.
- Don't release in autonomous mode — only on the human's explicit request.
