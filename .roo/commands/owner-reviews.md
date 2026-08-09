---
description: Deploy the interactive review contour "agent ↔ owner" — everything the agent wants from the owner (forks, reviews, approvals, answers) rendered as local HTML pages with recorded one-click decisions, a send-side approval gate, signaling, and accumulation for autonomous loops. Optional sugar on top of the hard canon rule "the place of questions is interviews/" (AGENT_GUIDE.md). Use when the owner asks to move approvals to rendered pages ("render my interviews", "set up owner reviews", "сделай вычитку страницей") or when a project adopts the place-of-questions practice with tooling. KAIF fixes the methodology (what must hold); the project's agent builds the tools (how). Field-proven contour (project E: "Мне нравится. Получилось удобно"). Trigger aliases (ru): «сделай вычитку страницей», «отрендери интервью», «разверни контур согласований»
---

# /owner-reviews — the owner-review contour

The hard rule already stands in `AGENT_GUIDE.md`: everything the agent wants FROM the owner lives
ONLY in `interviews/` (or a named decision-queue document). This skill is the OPTIONAL contour on
top: interviews and outbound drafts rendered as local HTML, decisions recorded with author and
time, sends mechanically gated by approval. The field's main lesson goes first: **HTML is not the
goal but the transport; the goal is the GUARD** — the place-of-questions rule was broken by an
agent who knew it, and the guard found two questions nobody saw, hanging 5 and 13 days.

KAIF fixes NAMES and INVARIANTS; the implementation belongs to the project's agent. Zero external
dependencies is explicitly encouraged — the field contour is a ~100-line markdown mini-renderer, a
stdlib localhost server that lives seconds (serve → record → die), system utilities for
voice/sound/notification/browser; the page is self-contained and opens offline. The temptation to
take a static-site generator or UI framework is large and the win is zero.

## Build order (field-corrected: "ours was worse")

1. **The place-of-questions guard** — depends on nothing, pays immediately, shows the real scale.
2. **Render + decision record** — the core; the metadata contract lives here.
3. **The send-side gate** — makes approval mechanical; without it the page is decoration.
4. **Signaling** — useless before there is something to show.
5. **Accumulation for autonomous loops** — needed exactly when the practice enters day/night loops.
6. **Pilot on REAL data** — the only thing that catches seam defects.

**Acceptance criterion:** a full routine cycle passes **without a single clarification in chat**.
Not "the page opened" — "the owner approved and the agent never had to re-ask".

**Borrowing from a donor project.** When the owner points at a neighbor project as the model
("theirs came out better — study it"), the reading order is: **its bugs → its plan → its code**,
and the recon is not finished until its EXPERIENCE file and its upstream queue are read — what
the owner names aloud is what they noticed as a user; what their agent already SUFFERED lies in
the bug tracker, and skipping it means paying for the same defects again. Borrow the INTERFACE
and the lessons, never the files: a copy is a second truth with two places to fix.

## The invariants (normative — a contour without them falls apart)

One number space, I1–I38. I1–I7 are the original core; I8–I36 were each paid for by a field
incident in one of three projects running this contour (the tool ate an hour of the owner's work ·
a show replaced by a file path · an answered question re-asked two days later). I37–I38 name the
notice class and arrived differently — not after an incident, but on the owner's request that the
contour be able to TELL, not only to ask.

- **I1. md is the source, HTML is derived. Always.** The page is built from the document and never
  hand-edited — otherwise a second truth appears and the next empty-context session misses
  decisions.
- **I2. An answer is recorded in THREE places:** back into the source md (the next session reads
  the document) · `<doc>.decision.json` beside it (machine check before send) · a copy in the
  decisions archive with `by` and `at` (who decided, when). The decision filename is DERIVED from
  the document name — a shared decision file gets overwritten by the next interview. An answer the
  owner already wrote is NEVER overwritten: a new text arrives as a dated follow-up field, the
  original stays verbatim.
- **I3. Approval binds to the SHA-256 of the BODY, not to the click.** Text changed after approval
  = approval void, checked by machine. **And agree on normalization** — who strips what, at which
  step: the field's costliest defect was the page hashing file bytes while the sender hashed
  normalized text (trailing `\n` stripped); both self-tests green, the gate would refuse every
  artifact always. Only the end-to-end pilot on real data caught it.
- **I4. The gate stands on the SEND side, fail-closed.** The sending tool itself reads the
  decision, requires `approved` for THIS artifact, re-checks the hash — and refuses non-zero even
  under an explicit `--apply` when the decision is missing, `rejected`, or the text drifted. Any
  doubt = refusal. A request never self-approves by timeout.
- **I5. The signal follows a successfully opened page** — call the owner from the renderer, after
  the page is up; otherwise you get the class "summoned, nothing to show".
- **I6. Quiet hours override everything**, including an explicitly requested voice level:
  autoloop → quiet hours → setting. The window CROSSES MIDNIGHT (e.g. 23:00–09:00) — naive
  `from <= now <= to` is silent all day and loud all night; that comparison deserves its own guard.
- **I7. Autonomous loops accumulate, never block.** The queue is a STATE FILE — never move live
  documents into a pending folder (moving breaks every link to them from status and plans); one
  "N accumulated" page (each card linking to its document) calls the owner ONCE per batch. Paired
  with I8, the batch page must not live long: the owner answers one document, the contour closes
  and wakes the agent; if the queue still holds items, re-raising the batch is the agent's duty.

**The waiting-and-wake loop (I8–I14):**

- **I8. Saving wakes the waiter.** Field wording, vendored verbatim: *"The contour must WAKE the
  waiting agent on save. The agent learns of events by the TERMINATION of a process it started —
  therefore a long-lived server and a wake-up are mutually exclusive, and the wake-up wins. Any
  recorded decision terminates the contour; if anything remains unanswered, re-opening the page is
  the AGENT's duty, never the human's."* Every check before this one asserted the path TO the
  human; the path BACK is what the contour exists for.
- **I9. The machine's patience is infinite.** Waiting for a human's answer has NO timeout by
  default — the default is `0`, not "a big number" (a finite default gives the same defect, just
  rarer, and a rare defect is worse: it arrives when nobody expects it). A finite limit is an
  explicit flag for automation only, and it means tolerated SILENCE, never a deadline on thinking.
- **I10. Refusing the human's work must be LOUD.** Every network call that carries the human's
  work sits in try/catch. Mechanical test: "does a path exist where the save button stays disabled
  and no error status shows?" — if yes, that is a defect, not an edge case. A silent refusal is
  worse than a crash: a crash is seen at once, silence eats an hour.
- **I11. A rescue ring on the client.** Recording failed → the human's text comes back onto the
  page: a field with the full content, a Copy button, a Retry button, the save button re-enabled.
  The human's work has no right to exist only in the RAM of someone else's process.
- **I12. A draft in the browser.** `localStorage` on every input, restored on page load with a
  visible "picked up N fields" notice. Insurance never lives inside the thing it insures against —
  the server is exactly the part that dies.
- **I13. The receiver's pulse (page → server).** The page polls `/alive` (default every 15 s;
  10–60 s envelope) and says out loud the moment the server goes silent — the human learns of the
  trouble immediately, not after an hour at the click. The one measure that makes the
  ate-the-work defect impossible rather than fixable.
- **I14. The reverse pulse (server ← page).** Closing the page is an EVENT for the server. Two
  channels: a `sendBeacon('/closed')` on `pagehide` (fast path; wait ~3 s to tell a reload from a
  close) plus a silence watch (threshold with a large margin, ~3 min, against background-tab
  throttling; two strikes against machine sleep). Infinite patience (I9) is right only while the
  addressee is alive — if a contour can notice its partner's death in one direction, it must
  notice it in the other.

**Antagonists — read as ONE block.** I8 (the process dies ON EVENT) ↔ I9 (never BY CLOCK) ↔ I14
(patience lasts while the page lives). The forbidden reading is named: *"since the process must
die anyway, let it also die on a timer"* — that false symmetry is exactly what the field paid for.

**Showing (I15–I17; the canon lives in `AGENT_GUIDE.md`, the contour enforces it):**

- **I15. Showing is an action, not a link.** Whatever the agent wants the human to perceive, the
  agent OPENS ITSELF; "lies at path…", "opens by double-click", "see file X" addressed to the
  human are banned as a way of showing. The path is a footnote AFTER the show, never an errand.
- **I16. The show contour = the question contour.** The page opens ANY markdown, not only
  documents with questions; the document-wide comment field lets the human answer or stay silent.
  No separate show tool is ever built.
- **I17. A mechanical check on showing.** Grep the agent's own reply for "double-click", "opens
  offline", "see file", "lies at" next to an artifact extension — a hit means the show was
  replaced by a link. The rule holds through an executable command in rituals, not through intent.

**Answer propagation — the return leg (I18–I21; procedure in `/interview`):**

- **I18. A question declares its ANSWER TARGET, written together with the question.** The agent
  knows which line of which document is blocked exactly at asking time — that knowledge is the
  reason to ask; the field is cheaper than any memory.
- **I19. Closing an interview is PROPAGATION, not a status flip.** Every declared target cites
  "interview #NNN, QN" and is brought in line with the answer — including REMOVING what the answer
  cancelled (a stale risk or phase order left alive keeps steering the plan). The status change is
  the LAST action. Cap on form: one citation in the blocked document — not a traceability table,
  not a separate register.
- **I20. The return-leg guard.** For every ANSWERED question, check that its declared targets cite
  it. Inherited debt goes into a baseline (key: `file + sha1(text)`), red fires only on NEW items,
  the debt count prints on every run and must go down. The summary reports BOTH legs — a one-leg
  "0 waiting" is a false green; the unit is the QUESTION, never the interview file.
- **I21. Old interviews without the target field get a heuristic, not a refusal:** at least one
  citation anywhere outside `interviews/`. Zero migration; history is not rewritten.

**Provenance (I22–I24):**

- **I22. Provenance has TWO representations:** machine (ISO, for the archive and programs) and
  human (local time in words, next to the answer and on the question card). One never replaces the
  other.
- **I23. Time shown to a human is always LOCAL.** UTC in the interface is a lie about the human's
  own action.
- **I24. The markdown renderer strips HTML comments.** Escaping foreign markup and displaying
  service comments are different things; inside fenced code, comments stay (there they are
  content). Fix it in the renderer — one node covers all present and future markers — and every
  path that shows document text to the human must go THROUGH that node: an answer excerpt on a
  card that bypasses the renderer re-leaks the marker (field pilot, same class as the original
  leak).

**Window, port, outcomes, process (I25–I31):**

- **I25. There are exactly three outcomes, all visible in the process log:** decision recorded ·
  page closed without an answer · interrupted by the human. "He's probably still thinking" is not
  an outcome.
- **I26. A separate app window (`--app=`), never a tab** in the human's working browser window —
  both the owner's explicit ask and a technical truth: auto-close is only possible in a window the
  script itself opened.
- **I27. Auto-close is an ATTEMPT, not a promise:** ~2 s after the answer is recorded; if the
  browser refuses, the page honestly says "please close me" — never a silent "hangs as it was".
- **I28. The voice call by name is the DEFAULT level,** not an option for the brave: a voice built
  but switched off by a setting exists only on paper.
- **I29. One document — one window.** A lock with pid and address; a second launch prints the live
  address and exits. Two windows are two calls AND two different drafts — the port is part of the
  web origin, so a draft written in one window is invisible to the other.
- **I30. A free port (`listen(0)`), never a fixed one.** On a fixed port a live old server
  silently wins the race, `curl` returns 200, and the human reads a STALE page; the `pkill`
  temptation (which kills the page open in front of the human) disappears with it.
- **I31. Process termination is the answer-delivery channel.** The agent starts the contour as a
  TRACKED background task and subscribes to its termination; a bare `&` is not tracked by the
  harness and no notification ever comes.

**The call (I32–I36):**

- **I32. The call never blocks the contour.** Speech synthesis takes seconds; a synchronous call
  steals them from the page server — the human stares at an empty window instead of questions.
- **I33. Chain order matters: instant sound → banner → voice.** A parallel launch lays the beep
  over the speech. Default beeps: 880 Hz/160 ms → 660/160 → 990/260, then the voice.
- **I34. The sound path must not depend on user OS settings.** Native notifications get muted
  silently with a success exit code; the beep goes through the sound card; delivery is confirmed
  WITH THE HUMAN, never by exit code.
- **I35. The voice falls back honestly to the system one.** No engine on this machine (other box,
  removed venv) — the approval contour has no right to break over timbre; make route choice a pure
  function so both branches sit under guards regardless of the machine running the checks.
- **I36. Text normalization for speech lives in the ENGINE, not in the project.** The call phrase
  almost always carries a number ("interview #16"); without normalization digits get swallowed or
  spelled out. Heavy shared resources (the TTS model, its venv) belong to the MACHINE, not the
  project: the project calls a ready command and falls back honestly when it is absent.

**The notice class (I37–I38) — the contour also has something to SAY:**

- **I37. "Notice" is a named class, not a question with no options.** A contour that can only call
  when the agent NEEDS something (an answer, a proofread, an approval) has no home for the second
  legitimate reason to call: the agent has something to TELL — a night-cycle result, an important
  finding, a long job finished. Without the class, such a page either waits for an answer nobody
  owes it, or the news goes into a chat the human never has to read. The class carries its own
  form (the document body plus an explicit mark, never answer options), its own call phrase that
  says "no answer expected" so the human decides whether to go BEFORE reading, and its own normal
  outcome: **read** — success, exit code 0, never "closed without an answer".
- **I38. Delivered = an EXPLICIT mark by the human, and nothing else.** A page that was opened,
  scrolled, or auto-closed proves nothing about a human having read it; the only evidence is a
  deliberate act — a "read" button, a radio, or a filled comment. Until that mark exists the notice
  is NOT delivered: it stays in the queue and is shown again with every batch the agent raises, and
  **re-delivery is the agent's debt, not the human's memory**. The mark is contour STATE, so it
  lives in the queue file, never inside the owner's document — and a notice marked read with no
  comment must leave that document byte-for-byte untouched. Unread notices accumulate under the
  questions, never above them: questions block work, notices do not, and the page order is where
  the human sees that difference.

## The named class: "handling the human's work"

Every defect the owner catches personally is a defect of handling their TIME and WORK, not of
rendering — and none of them is found by any mechanical self-check. The class is therefore
verified BY ROSTER, walking the field-paid cases one by one, not by self-tests: no-timeout
waiting (I9) · loud refusal (I10) · rescue ring (I11) · browser draft (I12) · both pulses
(I13/I14) · app window, not a tab (I26) · auto-close attempt (I27) · voice by default (I28) ·
project name in the header (page element P9) · never restarting the contour under a LIVE window
(field pilot: an "improved page" restart burned the owner's in-progress draft — the port is part
of the web origin, a new server orphans the old draft; fixes wait for the I25 outcome).
Accepting a contour = walking this roster.

## Page elements by name (P1–P9) — one style across projects

- **P1** — question widget with a 4–5 px state stripe on the left edge; the stripe's color IS the
  state (waiting / answered): one detail carries two meanings — separates and informs.
- **P2** — explicit state tags on every question: answered / unanswered / awaits you.
- **P3** — selection clearable by a second click (a native radio cannot return to "none").
  Field-corrected mechanics (pilot 2026-08-07 — the mousedown/click scheme still let the label
  duplicate the click, and the second click "cleared and instantly re-selected"): take the
  activation over on `pointerdown` with `preventDefault` — the native label duplicate ceases to
  exist by construction; a click on the FIELD toggles (the second click CLEARS), a click on the
  label text selects but never clears; disabled inputs are skipped.
- **P4** — no "who answers" question on a one-owner project; the server still stamps `by` —
  remove the QUESTION, not the RECORD, or the archive is unreadable months later.
- **P5** — both OS themes via `prefers-color-scheme`, colors as variables, contrast measured in
  pixels from day one.
- **P6** — embedded media: `data:` URIs for audio and images, `srcdoc` iframes for live mockups (a
  `file://` link from an http page is blocked — embedding is the only working path). A choice
  among four mockups opens as a SEPARATE window (opened by script → closable by script); the
  inline frame is for quick previews of smaller decisions.
- **P7** — a comment field per question AND a document-wide comment at the bottom; the latter is a
  legitimate review outcome on its own ("no answers, but something to say"), appended as a dated
  block — comments accumulate, never overwrite.
- **P8** — a markdown mini-renderer (~120 lines), zero dependencies, escaping as the FIRST action.
- **P9** — the project name in the page header: the owner runs several projects, and the document
  title alone does not say WHO is asking.

**The page speaks the owner's language.** The interface chrome — state tags, buttons, notices,
the header summary — follows the language the owner works in, not the tool author's: English
chips over a Russian interview are not user-friendly (the owner's word, field pilot 2026-08-07).
The header carries a visible answered/awaiting summary; a question card carries the question's
FULL body — its origin, what it feeds and blocks, the answer target — not just the title: an
owner facing options without context answers "I don't know what we are deciding here".

## The name contract (candidate, field-tested on four product routines)

Metadata block in the document head (fenced YAML): `title` · `kind` (interview / outbound draft /
…) · `artifacts:` list of approvable bodies, each `{id, target ("Slack · #channel"), format,
body_file}`. **`body_file` is a LINK, not a copy-paste** — the page shows exactly the bytes that
will leave, and the hash is computed over them; a pasted copy is a second truth and breaks I3.
Decision record: `kind, document, by, at, comment` + `artifacts: {<id>: {status, sha256}}` for
drafts / `answers: {Q1: {choice, text, comment}}` for interviews. `by` is not decoration — it is
what makes the archive readable months later.

## The executable build contract (C1–C13) — assemble by steps, don't re-invent

The agent on ANY project assembles the contour from THIS contract — step by step, never
re-derived from loose requirements. The contract itself is the packaging: the contour travels
between projects as this text, never as copy-pasted tool files — a copy is a second truth with
two places to fix. And a reminder stands AT THE DECISION POINT, not in a list of rules: each
tool prints its own warning where the temptation arises — the render command ends by printing
`RENDER IS NOT YET A SHOW` plus the ready-to-run open command, exactly where the temptation to
hand over a path is born (I15).

- **C1. What you build — four tools and one shared module.** Zero external dependencies — only
  your platform's stdlib and the browser that is already there (names below are the field
  convention; the ROLES are the contract):

  ```
  tools/
    questions-guard       the place-of-questions guard (step 1)
    lib/review-core       the CORE: normalization, hash, parsing, decision writes
    review                the review page, server, signal, queue
    review-gate           the send gate, fail-closed
    send-outbound         the gate's real consumer
    verify-<contour>      the QA run in a live browser (step 6)
  interviews/
    decisions/            machine memory of decisions (+ archive/, queue.json)
  ```

  EVERY consumer — the page, the gate, AND the guard — parses documents through this one core:
  a duplicated parser is a second truth (in the field the guard's own copy diverged from the
  core on "a comment is not an answer" within a single day).

- **C2. The order of the six steps is the Build order above, the guard FIRST** — confirmed in
  the field by execution: not one step had to be moved. Before any code, MEASURE: grep the
  working directories for candidate markers and hand-triage how many are real — that number is
  your debt, and it shapes the guard.
- **C3. The normalization-and-hash contract is written FIRST, before either side:**
  `normalize(s)` = strip BOM → CRLF/CR to LF → strip the trailing whitespace tail → exactly one
  final newline; `hash = sha256(normalize(bytes))`. One function, one module, both sides call
  it. The self-test must assert that four FACES of one text give ONE hash — CRLF, BOM, extra
  trailing blank lines, missing final newline — and that a different text gives a different
  one. (This is the mechanics behind I3.)
- **C4. Five parsing rules — written against live text, not fixtures:** (1) a question block is
  closed not only by the next heading but also by a horizontal rule `---` — otherwise the rule
  lands inside the answer text and an empty question turns "answered"; (2) a field labeled as a
  counter-question is NOT an answer; (3) an answer option parses MULTILINE — collect the item
  with its indented continuations first, only then look for the closing `**`; (4) the truth
  about whether an interview is closed is the DOCUMENT STATUS, never field fullness; (5)
  regexes take `\p{L}` with the `u` flag — `\w`/`\b` stay ASCII-only even with `u` (rake 7),
  and the guard silently misses its own language.
- **C5. The page** — the elements are named above (P1–P9); the contract adds nothing on top.
- **C6. Decision writes — the three places of I2, with derived names:** back into the source md
  with a provenance comment · `<doc-base>.decision.json` beside it · an archive copy
  `<doc-base>--<time>.json` that is never overwritten. The owner's already-written answer is
  untouchable — new text arrives as a dated follow-up field; the document-wide comment appends
  as a dated block at the END of the file. Three write rules paid for by the field pilot
  (2026-08-07): questions are applied BOTTOM-UP — an inserted comment shifts every line below
  it, and stale positions wrote one answer's tail onto a neighboring OPTION line; a comment
  WITHOUT an answer never closes a question (it is a thought, not a decision); an ANSWERED
  question still offers an additional-comment field on the page — the comment lands as a dated
  block, the answer stays verbatim.
- **C7. The send gate — one function `checkApproval(document, artifact)`, called by BOTH the
  gate and the sender.** Refusal on: no decision · status not approved · artifact not declared ·
  body missing · hash drifted · any unexpected error. It never throws — it returns a refusal
  (I4). The sender must have a REAL addressee and refuses even under an explicit `--apply`:
  without a real consumer the gate is decoration.
- **C8. The signal:** strictly AFTER the page is up (I5) · sound first and always (I33/I34) ·
  the voice is a parameter, the phrase = document type + its name + the COUNT of unanswered
  questions (the human decides "now or after the current task" BEFORE reading the page), the
  type taken from the metadata block or the directory · markup never rides into speech (strip
  md symbols from the phrase — in the field markdown leaked into the voice) · quiet hours
  override everything, and the midnight-crossing window gets its own self-test (I6) · the text
  rides to the synthesizer as a FILE and the command itself is ASCII-only · print plain text to
  the console — the exit code does not prove the human heard.
- **C9. Accumulation — and immediately I8.** The queue is a state file; live documents are
  never moved (I7). Any save closes the contour; if the queue still holds unanswered items,
  re-raising the page is the agent's duty (I8). The command that holds the server MUST have a
  build-and-exit flag (`--no-serve`) — otherwise any synchronous caller, your own QA run first
  of all, hangs forever; and every child call inside the guard carries a hard deadline.
- **C10. The QA run in a live browser — eleven blocks, the minimal field set that caught
  everything:**

  | Block | What it asserts |
  |---|---|
  | Core self-test | normalization, quiet hours, parsing, render, metadata block |
  | **Before the click** | the answer is in NONE of the three places — without this pair, "answer found" paints any prehistory green |
  | Gate before approval | refuses; the sender refuses under `--apply` |
  | Page × 2 themes × 2 widths | cards, options, tables, the state stripe in PIXELS and COLOR, contrast, no horizontal overflow, a clean console |
  | Selection | a click highlights · **a second click clears** · a third selects again · a neighbor extinguishes the previous |
  | One-click answer | reached all three places · `by`/`at` provenance · **the source answer not clobbered** · follow-up as a separate field |
  | **The wake-up** | the contour terminated on its own after the save |
  | Gate after approval | passes · text drift voids the approval · **CRLF+BOM do NOT break it** |
  | **Option count** | candidate lines = parsed options across ALL live documents |
  | A live document | a real interview, not a fixture; zero external loads |
  | Cleanup | the run writes decisions and cleans up after itself, with a "trace removed" check |

  Prove it by mutations — the field's set: killed the dark theme → 2 targeted failures ·
  disabled the md write → 4 · restored single-line option parsing → 5 (that one also exposed
  the defect eating an option in one more live interview) · the guard's three mutations.
- **C11. What NOT to do — seven points:** don't take a static-site generator or a UI framework
  (the temptation is large, the win is zero) · don't write `|| true` in a check — a check that
  cannot fail ASSERTS and steers the next diagnosis away · don't bind checks to the mutable
  state of live data ("question X awaits an answer" turns red the moment the tool succeeds) ·
  don't move live documents for the queue's sake · don't keep artifact bodies as copy-paste in
  the document — only a file link, or the approval loses its binding to bytes · don't take
  `exit 0` as proof of signal delivery (rake 3) · and above all — don't retell the question in
  chat once the contour is built: the cure is one, the owner's queue opens as a PAGE, not as a
  paragraph (rake 2).
- **C12. Platform traps — the catalog below (T1–T11).**
- **C13. Price and time, a planning reference from the field:** ~1,700 lines in 5 files, zero
  dependencies; 118 live-browser checks + 40 self-test checks, 5 mutations; one session —
  including 7 defects and 6 owner corrections along the way. What paid off first was the GUARD,
  before the page even existed.

### Platform traps (T1–T11) — warned in advance, each paid for in the field

- **T1 (browser).** `window.close()` is not allowed to every window → raise the window with
  `--app=`; keep closing an ATTEMPT with an honest notice (I27).
- **T2 (browser, QA).** Headless proves the WRONG thing: there `window.close()` is always
  allowed → verify window behavior on a VISIBLE window, on a throwaway profile.
- **T3 (browser).** `pagehide` fires on reload and navigation too → mark intentional departures
  with flags; after a beacon the server waits ~3 s for the page to come back.
- **T4 (browser).** Background-window timers get throttled (down to once a minute; intensive
  throttling after 5 min) → a silence threshold with a large margin (~3 min) plus the beacon as
  the fast path.
- **T5 (OS).** Machine sleep stops the timers on BOTH sides → two strikes: the first check only
  marks a suspicion, the second (a tick later) decides.
- **T6 (browser).** The port is part of the web origin — the draft "vanishes" on a new port →
  a lock per document, never a second window, restore the draft on load (I29, I12).
- **T7 (JS templating).** A backtick inside a template string of the page builder drops the
  module with a syntax error in an UNRELATED place → only typographic quotes inside the block;
  print the warning in the file itself.
- **T8 (self-checks).** A self-check tripping on its own text: the phrase in a comment rides to
  the page together with the code → never repeat verbatim the thing whose absence you guard.
- **T9 (Node, imports).** A guard that others import must not execute on import (guard the
  entry: `import.meta.url === process.argv[1]`) — otherwise the page kills itself with the
  guard's `process.exit`.
- **T10 (Node, paths).** Resolve document paths with `resolve`, not `join` — or the first
  document outside the repository greets the human with a raw stack.
- **T11 (Windows / PowerShell).** Searching for a process by command-line substring finds the
  search itself → filter by process NAME first.

The remaining platform traps — text travels through FILES, not CLI arguments; backticks inside
double quotes; CRLF-tolerant regexes; re-reading after any machine edit of non-ASCII text — are
already project canon (`AGENT_GUIDE.md` → document & text hygiene): the contract references
them, never duplicates.

### Canonical defaults (DEF1–DEF8)

Canonical defaults, an owner-approved envelope; a project departs from them only on its OWNER's
word.

| # | Constant | Canonical default |
|---|---|---|
| DEF1 | Call beeps | 880 Hz/160 ms → 660/160 → 990/260, then the voice |
| DEF2 | Window auto-close | `window.close()` attempt 2000 ms after the record; the fallback "please close me" notice is cancelled by `pagehide`, with a 2000 ms reserve for the case closing is refused |
| DEF3 | Server death after the record | 2500 ms — a technical pause so the window can leave; not a user constant |
| DEF4 | Page → server pulse (`/alive`) | default 15 s; allowed envelope 10–60 s |
| DEF5 | Waiting for the human | timeout 0 (none); `--timeout N` is for automation only and means tolerated SILENCE; the silence check ticks every 15 s |
| DEF6 | Reverse pulse | `sendBeacon('/closed')` on `pagehide` + a silence watch; silence threshold 3 min; ~3 s wait after the beacon (a reload is not a close); 2 strikes against machine sleep |
| DEF7 | Call timings | the beep's child call carries a hard 8 s deadline; the voice — a 60 s timeout; the first cold call takes up to ~11 s — the beep-first order covers the pause (pre-warming is advice, not a requirement) |
| DEF8 | Window | `--app=<url>` + `--window-size=1100,900`; fallback order: Edge → Chrome → a plain tab with the honest "please close it yourself" |

## Guard norms (G1–G13) — how the contour's checks are built

The field wording, vendored verbatim: *"A guard that is red from birth is not a gate."* Every
guard below proves itself RED on a broken version before its green means anything.

- **G1. The place-of-questions guard: narrow signs, explicit exceptions.** Two strong signs
  instead of ten weak ones: a queue HEADING ("Awaits the owner", "Open questions to the
  owner") · an address at the START of a line (the marker within the first ~40 characters of
  content, past list/quote markers). Do NOT catch prose mid-paragraph or lines that already
  point to the place of questions (containing `interviews/` or "interview #"). Exceptions are
  explicit only, with the reason on the line — a marker with an EMPTY reason is itself a
  violation, otherwise the marker becomes a way to silence the guard. An unanswered interview
  is a REPORT, not a violation. Minimum three mutations, by name: a new violation → red · a
  marker with a reason → green · a marker with an EMPTY reason → red.
- **G2. A debt baseline (ratchet) — the norm for ANY new guard on an old project.** Snapshot
  the inherited debt, fire red only on NEW items, print the debt number on every run — and it
  must go down. (I20's mechanics, generalized to every guard born on a living project.)
- **G3. The stale-status detector — the guard's second half.** A "waiting" status over zero
  empty fields = "STATUS IS STALE": the document looks alive and the next session waits for
  what was long given. The two halves answer opposite questions. (Procedure canon lives in
  `/interview`.)
- **G4. The question-content guard.** A question to the owner is a STATEMENT about the canon's
  state and is checked as one (the principle is canon in `/interview`): entities named in
  options must exist — paths on disk, tasks in the tracker; a MANDATORY intent note
  `<!-- new: … -->` for what does not exist yet, otherwise the guard forbids asking about the
  future; a negation ("nowhere", "never") must be proved against the whole source, and only in
  OPEN questions; the owner's ANSWER is never checked; check only what has a source of truth.
  The guard stands at the SHOW point and never blocks — findings print before the page
  address (a blocking gate here would be a third form of the same sabotage). Calibration: only
  STRONG negation forms — a weak "no" drowns the guard.
- **G5. Rules belong on FIXTURES; live data gets only invariants** — statements true in ANY of
  its states. The defect's tell: a concrete number or a live document's name inside a check;
  such checks turn red at the moment of the tool's success (the owner answered).
- **G6. Recognition is built NEGATIVELY.** "A letter NOT followed by …" instead of a list of
  allowed separators: to enumerate the allowed is to one day not enumerate — in the field, two
  options out of three silently did not show, under a green counting check.
- **G7. An independent sign + a frozen etalon reviewed with eyes.** "Found as many as I
  searched for" is self-confirmation, not measurement: the cross-check must be INDEPENDENT of
  the checked parser — a sign of another nature, whose false hits are allowed (the etalon
  extinguishes them); a new document intentionally fails the run until the etalon is
  re-reviewed.
- **G8. Localize the comparison inside question blocks.** A document-wide count drowns the
  signal in noise. Companion: a measured "100%" or "0%" is first of all a reason to suspect
  the instrument, never a sensation.
- **G9. "A false alarm is worse than a miss" — the principle, held in full by rake 5 above**
  (raised there to principle rank). The G-series names it because guard-building is exactly
  where it gets violated; the normative text lives in rake 5 — one copy, no drift.
- **G10. Mutation with a PREDICTION; bind to your own object; search the syntax, not the
  word.** Half the field's guards could not turn red until mutation-tested — and two mutations
  SURVIVED at first, which is worth remembering: predict each mutation's exact failure before
  running it. A file-wide guard gets satisfied by a neighbor's object — bind the check to its
  own line. Search the syntax `owner-review:` with the colon, never the bare word.
- **G11. Count, don't look: the option-count cross-check.** The number of candidate lines must
  equal the number of parsed options across ALL live documents. A silently lost option is this
  contour's worst defect class: the page looks fine and the decision is made over a truncated
  list.
- **G12. A layout fixture holds BOTH a short and a long variant.** A replaced element in a
  flex row gets squeezed by a long neighbor; on a short example the defect does not reproduce
  at all — the check is green by construction.
- **G13. Frame self-review with a SUBJECT: compare same-type elements.** Look as a geometry
  comparator, not as a reader — in the field the whole option list printed TWICE and each copy
  looked normal by itself; a page screenshot goes into the task's artifacts.

**Red proof, guard by guard (the gate of this section):** place-of-questions — the three G1
mutations by name · return leg (I20) — delete an answered question's citation from its
declared target → red · stale status (G3) — a "waiting" status over a fully-filled fixture →
red · content (G4) — an option naming a nonexistent path without the `new` note → red ·
show-grep (I17) — a reply fixture saying "see file X.pdf" → red · dead server (QA7) — the run
against a pre-fix page must fail its etalon values · reverse pulse (I14) — close the page: a
server that outlives the silence threshold → red.

## The acceptance checklist (QA1–QA7) — accepting a built contour

- **QA1. A live acceptance in a real browser:** raise the contour → open → click → save → the
  answer landed in all places and the process terminated on its own.
- **QA2. Window behavior on a VISIBLE window,** as a separate run (T2 — headless proves the
  wrong thing).
- **QA3. BOTH "page left" scenarios:** a reload — the contour must LIVE; a close — it must
  DIE. Checking only the second means not noticing that you kill live pages.
- **QA4. A frozen parse etalon over the live documents,** with an intentional failure on a new
  document until the etalon is re-reviewed (G7). The field numbers behind this norm are cited,
  never re-measured: 39 fixture checks → 0 findings, while the FIRST run over 16 live documents
  caught 2 silent losses — out of 281 checks total.
- **QA5. Proof by mutation:** a broken parse must fail the run — a check that cannot fail is
  not a check.
- **QA6. Cleanup:** debug windows and browser profiles are extinguished at the run's end — the
  owner works at the same machine.
- **QA7. The dead-server headless check:** capture the live page → kill the server → type an
  answer in a real headless browser → click → read the DOM. The "after the fix" etalon, all
  five: rescue block present = true · save button re-enabled = true · the answer present in
  the output = true · the draft persisted = true · the status honest.

## Rakes to warn about (in falling price order)

1. Hash without a normalization agreement → the gate refuses always, on green self-tests (I3).
2. **Tool built, agent not using it** — the same day the page worked, the agent retold questions
   in chat: chat is cheaper in the moment. A tool counts as ADOPTED only when a ritual carries the
   executable command that shows violations ("show ALL unanswered interviews on one page").
3. **Exit 0 ≠ the human got the signal** — native notifications get muted silently by OS focus
   settings with a success code. A must-arrive signal needs a path independent of user settings,
   and delivery is confirmed WITH THE HUMAN, not by exit code.
4. **Fixtures don't catch live documents** — three renderer defects surfaced only on the project's
   real files. A run over ALL existing live documents is a handover condition for the tool.
5. **A principle, not a tip: a false alarm in a guard is worse than a miss** — it teaches ignoring
   the tool, and it is violated most eagerly exactly while building guards; close each with its
   own guard. Expect ~10 false hits per real one for a text-rule guard; exceptions are explicit,
   with the reason on the line. Guess-heuristics ("option letters must run A, B, C") don't go into
   guards — precision is held by a frozen etalon, not by plausibility.
6. **Both OS themes** — dark-on-dark code blocks were caught by the owner, not by self-checks.
7. **Non-ASCII regexes:** in Node `\w`/`\b` are ASCII-only even with `u` — use `\p{L}` /
   `(?!\p{L})` with the `u` flag, or the guard silently misses its own language.

## Parameters and compatibility

- Sound/TTS are PARAMETERS: the voice name is a parameter, not a menu (a field machine had exactly
  one usable voice out of 185); quiet hours are mandatory, not optional.
- Industrial four on the page: **Approve / Reject-with-reason / Edit / Respond**; the payload is
  visible in full; the audit trail keeps refusals too.
- An answer's force never depends on transport: **HTML = md = chat** — all are the owner's word,
  recorded with `by`/`at` (equivalence rule, `/interview`).
- Interviews without the contour keep working exactly as before — the sugar never becomes a duty.
