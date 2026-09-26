# Research 40 — the owner's page and the call on KAIF 2.8: finish our own contour, or move to the shipped one

**Created:** 2026-09-26 16:2x +03:00 · **Parent:** the owner's word in the chat, 2026-09-26: «давай сделаем, что осталось, что 2.8
просит и у нас это пока долг - делаем. интерактивный контур, голос» · **Status:** decided (§5) · **Outbound:** `plans/104` ·
the `@fork owner-contour-2-8` block in `package.json`'s neighbour `tools/ask.mjs`

## 1. The fork — options as a list, and the price of error

KAIF 2.8 changed the owner-review contract (`.kaif/INTERACTIVE_CONTOUR_SPEC.md` §4–§6): answers saved ONE AT A TIME with the page
alive until the last question («Saved. Questions left: N»), a separate waiter `--wait <doc>` that wakes the agent on each answer, a
save that carries its revision (409 on a rewritten document, the typed text kept), the page at 1.7× and Save at 1.5×, and a call
outside a page (`--call "<what is needed>"`) that names the calling session. KAGO runs its OWN contour (`tools/review.mjs`, 1874 lines,
born before KAIF shipped one): it has the beeps and the owner's Silero voice, and none of the six 2.8 changes.

1. **Port** the six changes into `tools/review.mjs` (+ `tools/lib/review-core.mjs`, `tools/verify-review-contour.mjs`).
2. **Move** the owner's page and the call to the shipped `.kaif/tools/contour/review.mjs`; keep our voice through the environment
   interface the shipped contour reads; keep `tools/lib/review-core.mjs` (the questions guard and the send gate import it).
3. **Both** — keep ours for the batch page, the shipped one for single documents and the call.

**Price of error:** the owner's answers. A contour that loses a save, closes while he types, or speaks noise costs his time and trust
— the class of `bugs/64` («tidy hook closes the owner's review window mid-answer») and of origin #66 («the contour closed while I WAS
TYPING»).

## 2. How it is done by those who solved it (sources)

1. **KAIF 2.8's own canon** — `.claude/skills/owner-reviews/SKILL.md:30`, verbatim: «shipped generator; do not build a contour
   (`node .kaif/tools/contour/review.mjs <doc>`) — a project that still runs its own checks it against that». The framework that
   defines the contract tells a project to use its generator.
2. **The contract** — `.kaif/INTERACTIVE_CONTOUR_SPEC.md` §5–§7 (2.8): the six changes above, the flags table, and «Parameters are READ,
   never asked»; the rich voice is «a MACHINE resource reached through the environment (`KAIF_VOICE_TOOL`, `KAIF_VOICE`,
   `KAIF_SAPI_VOICE`) — never a path inside the project».
3. **The shipped implementation, measured here** — `node .kaif/tools/contour/review.mjs --selftest` on this tree, 2026-09-26:
   `contour selftest green: 111 checks`, among them «a page closed after a partial save: exit 2 and «closed after 1 saved answer(s) —
   recorded, nothing lost»», «recovery: an answer saved for an OLDER revision is kept as data», the waiter next to a live queue page.
4. **The practice of replacing a working legacy component in place** — the «strangler fig» pattern (Martin Fowler,
   https://martinfowler.com/bliki/StranglerFigApplication.html): route new traffic to the new component, keep the old one reachable
   until the new one has been seen working, then retire it. Named practice, not re-read in this session.
5. **This project's own record** — `bugs/64` (the Stop-hook `tools/tidy.mjs` closed the page mid-answer; fixed by `runInFlight`
   recognising a running `tools/review.mjs`), and the voice interface of our contour (`tools/review.mjs:85-86`: `node <tool> <phrase>
   --play --voice <name>`, tool `F:\KLAS\tools\voice-say.mjs`, voice `eugene`), which is exactly the interface the shipped contour calls
   (`.kaif/tools/contour/review.mjs:222-226`).

**Bounds of this recon:** one pass over the local sources above; no field report of another project's migration was read; the Fowler
page is cited as a named practice from memory.

## 3. Reflection, first half — why the practice is the best one

Porting means a second implementation of a contract that moves with every KAIF release — a truth↔mirror pair this project's own guide
prefers REMOVED to watched (`AGENT_GUIDE.md` → the pairs registry). The shipped contour is maintained where the contract is written and
is proved by 111 checks on this very tree; every future contract change arrives by `kaif:update`, not by a hand port. The strangler
fig answers the risk of the move: the old contour stays reachable (`npm run ask:legacy`) until the new one has been seen with the owner.

## 4. Reflection, second half — how it serves THIS project, and what does not transfer

- **The voice transfers without code:** both contours call the same tool with the same arguments; two environment variables carry
  it. What the owner hears stays his Silero «eugene».
- **What only we have and must not lose:** the Stop hook's `tidy` guard — it recognises a live contour by the path `tools/review.mjs`
  only, so after the move it would NOT recognise `.kaif/tools/contour/review.mjs` and could close the owner's page between two of my
  turns — exactly `bugs/64` again. The twin must move in the same change (`TWINS:`).
- **The call's phrase:** the shipped default addresses the owner by the AGENT_GUIDE identity row, «Mikalai Kryvusha», in Latin letters
  a Russian voice reads badly; our contour never names him — it opens with «Проект КАГО.». `contour.callName` = «Проект КАГО» keeps
  that, without inventing a Russian form of his name.
- **Not transferred now:** the batch page («N accumulated», `npm run ask:batch`) stays on the old contour — the shipped `--queue`
  page is the equivalent and is left for the next queue that actually has several documents.
- **Our queue file** `interviews/decisions/queue.json` has another shape; the shipped contour reads it as «the project keeps its own
  queue» and never writes into it (2.8, #100) — nothing to migrate.

## 5. Decision

**Option 2 — move the single-document page and the call to the shipped contour**, keep the old one reachable as `ask:legacy` (and for
the batch page), move the `tidy` twin in the same change, carry the voice by the environment, set `contour.callName` /
`spokenProjectName`. Option 1 rejected: a second implementation of a moving contract. Option 3 is option 2's transition state, not a
destination.
