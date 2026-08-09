# Bug 01 — the owner-review contour: 23 findings from its first adversarial review

**Status:** 🔴 OPEN · none fixed yet, none independently re-verified by the session that filed this
**Version/build:** commits `6879592` (contour) · `03ae141` (window-honesty fix) · **When/context:**
2026-08-09, session 2, immediately after the contour shipped and served its first live cycle

---

## Symptom

The contour WORKS — it rendered three questions, the owner answered all three, the decision reached
all three places and the server terminated on its own. That success is exactly why this document
exists: nine adversarial reviewers (three lenses × three artifacts) then ran the tools against
hand-built hostile documents and found **23 defects the happy path never touches**, 8 of them major.

The pattern across all of them: **the parts that were exercised are sound; the parts that were only
counted are not.** Counting cards and options proved the page renders; it did not prove the page
renders *everything*.

## Repro (deterministic)

Each finding below was produced by running the real tool against a scratch document, not by reading
code. The reviewers' own commands are quoted per finding. The parent session did NOT independently
re-run them — **that re-verification is step 1 of the fix**, per "a finding is not a finding until
verified" (`BUG_FIXING_FRAMEWORK.md`).

## Findings

### A. `tools/review.mjs` — the page loses document text (MAJOR, 3 findings)

1. **Everything BETWEEN question blocks is silently dropped.** `splitAround` keeps only the head
   (before the first question) and the tail (from the first non-question heading after the LAST
   question). Prose sitting between two questions never reaches the page. In a document where the
   owner is deciding, silently unrendered context is the worst possible defect class: he answers a
   question whose framing he was never shown.
2. **A document ending in plain prose loses its epilogue.** The tail is found only by scanning for a
   heading after the last question; with no further heading, `epiStart` stays at `lines.length` and
   the epilogue is empty.
3. **`renderMarkdown` mis-handles a fenced block that is not alone on its line** (in
   `tools/lib/review-core.mjs` — mine): the fence placeholder is only recognised when it occupies
   the whole line, while the substitution replaces a fenced block wherever it sits, including
   indented inside a list item.

### B. `tools/review.mjs` — three claimed invariants do not hold as named (MAJOR, 3 findings)

4. **I2 — the success summary is counted from the PAYLOAD, not from what landed in the md.** The
   contour can report "ответов: N" for answers `applyAnswersToDocument` did not write. A contour
   whose report of its own writing is unverified is precisely the fraud class the framework hunts.
5. **I7/I8 — `isWaiting` is bound to the document's `**Status:**` line, and nothing in the contour
   ever writes that line.** The queue therefore never clears itself; the parent session flipped the
   status by hand at closure, which MASKED the defect. `refreshQueue`'s own docstring promises the
   woken agent can read "how many are left" from the state file rather than guessing — and that
   promise is what is broken.
6. **I29 — the lock is keyed by the RUN, not by the document.** A batch run always locks `_batch`,
   so it never collides with a single-document window on the same document. "One document, one
   window" does not hold, and two windows mean two drafts on two ports.

### C. `tools/send-upstream.mjs` — the sender's guards after the verdict (MAJOR, 3 findings)

The gate's verdict itself (I3/I4) survived the attack: refusal with no decision, refusal under an
explicit `--apply`, pass when approved, void on real drift, tolerant of CRLF+BOM — all reproduced
byte-for-byte, including the spy showing `run() calls = 0` on the refusal path. What follows the
verdict is where it breaks.

7. **The addressee guard is a check that cannot fail** (C11): the regex has no start anchor and the
   `github.com` prefix is optional, so any URL-shaped target yields a fabricated owner/repo.
8. **Half the addressee defence is skipped when `format` is absent** — and `format` is optional; the
   sender itself prints «формат: не указан».
9. **The double-send guard is bound to a field the same file allows to be null:** a delivery is
   recorded with `url: null` when gh's stdout carries no URL, and the guard then does not see it.

### D. Minor findings (14)

Recorded in full in the workflow journal
(`…/subagents/workflows/wf_37fb46cf-7ad/journal.jsonl`, one `result` line per verifier). The
recurring shapes, worth naming because they are classes rather than instances:

- **Checks that cannot fail** (C11): `isAscii(ps)` over a string assembled from six literal ASCII
  fragments; a disabled-input skip in the selection handler for an input the page never emits.
- **`inlineMd` peels the wrapping `<p>` only for a SINGLE-paragraph render**, while
  `renderMarkdown` emits one `<p>` per source line — so every option whose text wraps (which is
  every option in the live interview) carries block markup inside its label.
- **The `/alive` interval is never cleared** and never consults the `saved` flag.
- **`syncQueue` runs before the `--no-serve` branch**, so a pure render stamps queue state.
- **The lock file is `.review-lock-<key>.json`**, which `.gitignore` does not exclude while its own
  comment says `interviews/decisions/*.json` is deliberately kept.
- **`review-gate.mjs`: a decision record with no `status` field at all skips the document-level
  status check** — the check is bound to the field's presence.

## Root cause / hypotheses

Not one cause; two, and both are about what verification was pointed at.

1. **The builders verified by COUNTING, and counting is blind to omission.** "3 cards, 12 options,
   0 leaked markers" proves what IS on the page and says nothing about what is missing from it.
   Findings A1–A3 all live in that blind spot.
2. **The invariants were implemented at the point they are stated and not at the point they are
   USED.** `isWaiting` reads a status line nobody writes; the summary counts a payload nobody
   compared to disk; the lock keys a run rather than a document. Each is locally sensible and
   globally false — which is exactly why the contract's own C10 asks for an END-TO-END QA run
   rather than per-file checks.

## Fix plan

1. **Re-verify before fixing.** Re-run each reviewer's quoted command; a finding that does not
   reproduce is dropped, not fixed. Half of model-produced findings are false until proven.
2. **Fix by class, not by instance** (`BUG_FIXING_FRAMEWORK.md` → close the class): A1+A2 are one
   defect — the page must render the WHOLE document with question cards spliced in, rather than
   reconstructing head and tail. D's "checks that cannot fail" are one sweep.
3. **Build `tools/verify-review-contour.mjs`** (contract C10, eleven blocks) as part of this fix and
   not after it. Nine blocks were run by hand in session 2 and caught real defects; the tool is what
   stops them being re-run by hand — and its "before the click" block would have caught B4.
4. **Each fix lands with the check that proves it red first.**

## Decisions made without the owner

*Filled at closing.* So far: filing 23 findings as ONE document rather than 23 stubs, because they
came from one review pass, share a fix session, and group into four classes — 23 near-empty files
would obscure that. Reversible: split if the fix session finds them unrelated.

## Links

- Built by the workflow `wf_37fb46cf-7ad` (12 agents, 3 builders × 3 verification lenses).
- The contour's contract: `.claude/skills/owner-reviews/SKILL.md`.
- Field report on building it: [KAIF#7](https://github.com/MikalaiKryvusha/KAIF/issues/7).
