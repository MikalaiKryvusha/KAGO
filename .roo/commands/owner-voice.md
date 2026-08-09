---
description: Take a stylometric PORTRAIT of the owner's written voice from their own texts and rewrite a project artifact by it, so AI text sounds like the owner's text. Two modes — portrait (capture the voice) and rewrite (re-voice an artifact under machine-checkable invariants). Use when the human says "make a portrait of my style", "write like me", "this is not my language", "перепиши моим голосом", "это не мой язык", "match my voice" — AND ON YOUR OWN INITIATIVE when the owner rejects a text over its language or style for the SECOND time: that is the signal that styleguide bans are not working and a portrait is needed. Field-proven methodology (project B, then applied cross-project); the portrait skeleton ships as .kaif/_owner-voice-template.md. The filled portrait is a separate OPTIONAL canon file: AUTHOR_STYLOMETRY.md. Trigger aliases (ru): «портрет моего стиля», «пиши как я», «это не мой язык», «перепиши моим голосом»
---

# /owner-voice — the owner's voice

A styleguide is a set of bans and structure demands: it answers "what not to write" and does NOT
restore a voice — a whole field epic went through a full styleguide pipeline and the owner still
said "this is not my language". The cure is a different instrument class: a POSITIVE portrait
("a stylistic LoRA") taken from the owner's own texts, where every rule is proven by their quote.
The portrait is a CANON document with a canonical name — **`AUTHOR_STYLOMETRY.md`** in the project
root: the agent writes it, the owner accepts it, and every later agent finds it without asking. It is
OPTIONAL — no portrait taken, no file, and no check reddens for its absence. The methodology is the
shipped skeleton `.kaif/_owner-voice-template.md`: **COPY it to `AUTHOR_STYLOMETRY.md` and fill the
copy**, never freestyle and never fill the skeleton in place — the blank and the portrait are two
different files.

**Why a portrait at all — the owner's own "soup" metaphor:** live human speech is a soup —
nourishing solids (meaning, connotation) generously wrapped in warm water, the optional "sugar" of
speech that makes it soft to swallow. An LLM is strongest exactly at MEANING, so its native text is
the strained solids alone: correct, densely packed — and no longer a soup but a porridge one can
choke on. A human proofreader feels that strain in every sentence, and the strain is what makes AI
text obvious. The portrait pours the OWNER's own water back — not random water, but his way of
thinking and speaking.

## When to invoke

- On the owner's ask; on the proactive trigger "second rejection over language".
- NOT for touching up three paragraphs — there, write with the portrait open and run its
  checklist; the full ritual starts at several units of work.

## Mode `portrait` — capturing the voice

1. **Corpus registry, via `/interview`** (asynchronous — work continues on what is already in the
   repo while the owner answers; such sources are marked "pending confirmation"). Ask by SOURCE
   CLASSES the owner won't recall unprompted: same genre pre-AI (highest weight) · any finished
   released work · current unmarked text · the foundation they LEARNED to write from · historical
   "embarrassing" texts (low weight but the only INNATE/ACQUIRED separator). Record the owner's
   restrictions VERBATIM in the registry ("take the language, NOT the formatting rules") — without
   that line the agent hauls content instead of style. Late additions are the NORM: a new source =
   a new analyst pass + a re-synthesis, never a restart. **The corpus gate** (thresholds in the
   skeleton) decides whether this is a portrait or only draft observations.
2. **One analyst per source** (same dimensions: syntax · lexicon · structure · punctuation/rhythm ·
   morphology; an observation without a verbatim quote is not accepted) **+ a separate
   ANTI-PORTRAIT analyst** on the AI text already in the artifact: what still sounds like AI after
   every formal ban is satisfied. That is half the value.
3. **Synthesis into the skeleton + an adversarial completeness critic** with the one question:
   *"could a weak session, armed with ONLY this document, write text the owner takes for their
   own?"* — returns "complete" or the list of holes.
4. **Acceptance by BLIND TEST** (the honest eval): 6–10 unlabeled fragments, half genuine
   owner texts NOT in the corpus, half agent texts by the portrait; the owner marks "mine / not
   mine"; accepted when they cannot tell better than chance. Every correct catch becomes a new
   anti-portrait row.
5. **The weave-in — a handover gate, all five points:** context router (task type "writing into
   the owner's artifact" ⇒ read the portrait) · the before-every-task checklist · the sphere
   library's binding evidence set · the artifact's styleguide (if any) · a machine guard in
   WARNING mode (calibrated on the live artifact first; noise above signal = no guard).
6. **Upkeep:** the portrait is alive and versioned, never DONE. Every owner edit at review is
   input: a rejected wording becomes an anti-portrait row; a rule rejected twice is deleted, not
   defended. Ripened machine heuristics graduate into a guard.
   **Feeding — the standing procedure, two entrances:** a NEW owner source, or the owner's "this is
   not my language" against a concrete place. Both run by the late-additions rule of step 1 above —
   it is stated there once and not restated here: a source is first written as a ROW into the corpus
   registry (with the owner's verbatim restriction) and then gets its analyst pass; a remark starts with an
   anti-portrait pass on the rejected place. Re-synthesis touches ONLY the modules that pass hit —
   a portrait is edited module by module, never regenerated, and a new genre is a new REGISTER
   inside the file, never a second document. Every feeding closes with a row in the portrait journal
   (§9): append-only, an older row superseded and never rewritten. A corpus from a genre the
   portrait has not covered is honest new ground — say so aloud in the new register.

## Mode `rewrite` — re-voicing an artifact

**Applicability gate first:** the pipeline assumes a TEXT artifact under version control with a
line diff. Slides/CMS/cloud doc → either convert with a PROVEN round-trip (export → edit → import
→ compare, tested on one unit BEFORE starting) or don't start; edit fragment-by-fragment via the
owner instead.

**Provenance is the precondition:** only text marked as AI-written is rewritten (the marks turn
"make it pretty" into a machine-bounded task: rewrite inside, not a character outside). Owner text
edited by AI (`[AI-ed]`) is NOT rewritten — only spot-removal of explicit anti-portrait markers.
No provenance? The ladder: (a) a pre-AI revision exists → machine-mark the diff from it; (b) the
owner names the last revision they vouch for (via `/interview`) → everything after gets marked;
(c) no history at all → **marks are never invented backdated** — rewrite mode is unavailable;
do `portrait` + "all new AI text under marks from now on"; the existing artifact is edited
fragment-by-fragment at the owner's direct word.

**The pipeline is a DELTA to `/fable-loop`** (do not restate it: rewriter → adversarial judge,
separate instance, reads the diff LINE BY LINE → up to two repair rounds → verified → invariants
check → one commit per unit). New here is only: the provenance gate, the invariants ladder, and
the no-meaning-fixes rule. The judge checks TWO things separately: meaning identity (numbers,
formulas, references, enumerated cases) and portrait conformity (by the anti-portrait and pairs).

**Invariants named BEFORE work, shown after** — the ladder, top to bottom:
1. universal minimum: text outside marks byte-identical to the previous revision + the FACT
   INVENTORY of the unit (sorted lists of numbers · proper names/terms · references · enumerated
   cases, before vs after — the diff of the two lists is empty; this is the parity-inventory craft
   under its existing name);
2. sphere bonus where it exists: linter · build · tests · byte-identical machine-consumer output;
3. neither available → the work is NOT handed over as verified: it carries `[NOT-TESTED]` and goes
   to the owner as a draft.

**Waves of 4–6 units, one commit per unit** (the only thing that survived three network drops in
the field). After a crash: revise the tree — keep what's whole, roll back what's broken, never
commit what wasn't judged; the resume list SHRINKS PHYSICALLY to the undone (a stale resume cache
happily rewrites accepted work).

**Meaning holes found while rewriting are NEVER fixed in passing** — they go to a suspicion list,
and a VERIFICATOR with the live text and the decision docs stands between the list and the backlog
(field: 75 suspicions → 8 real docs + 43 refuted; without the verificator the backlog gets half
garbage). Rejects are recorded WITH reasons.

**Handover — the self-review loop:** assemble the artifact → LOOK at it with eyes (render it if
visual — and prove the render path works BEFORE the first edit, not at handover) → not satisfied →
fix → look again → … → satisfied → report. Green checks are not a handover.

## What this skill forbids

- Starting with rewrite before a portrait exists (a lost epic in the field).
- A portrait rule without an owner quote; an empty skeleton section skipped silently.
- Fixing meaning under the guise of style; touching provenance marks.
- Declaring done without the named invariant shown and without eyes on the artifact.
- Transferring rules between languages or registers without their own quotes.

## Notes

- Frauds of this ritual live in the sphere fraud tables as ONE row ("Voice without a corpus");
  the rest are hunted by `/fable-judge` via its standing hunts (meaning drift = weakened checks;
  removed marks = provenance fraud).
- The judge is a separate agent instance; a harness without subagents runs the judge as a clean
  pass strictly by the critic checklist, forbidden to look at its own rationale.
