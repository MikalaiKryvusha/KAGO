# Bug 01 — the owner-review contour: the adversarial review, its true inventory, and the first fix pass

**Status:** 🟡 PARKED — every blocker closed · 23 fixed and guarded · 1 refuted · 30 parked by the
owner's ruling ("чини явные блокеры, и переходим к KAGO", 2026-08-10)
**Version/build:** contour at `6879592` / `03ae141` · fix pass at session 3 (2026-08-09 → 10)
**When/context:** filed 2026-08-09 session 2; re-verified and partly fixed session 3

---

## Symptom

The contour WORKS on the happy path — it rendered three questions, the owner answered all three, the
decision reached all three places and the server terminated on its own. That success is why this
document exists: nine adversarial reviewers (three lenses x three artifacts) ran the tools against
hand-built hostile documents and found defects the happy path never touches.

**The pattern across all of them: the parts that were exercised are sound; the parts that were only
counted are not.** Counting cards and options proved the page renders; it did not prove the page
renders *everything*.

## Correction to the previous revision of this document — the inventory was wrong

The first revision reported **"23 findings, 8 major"** and pushed the rest into a line pointing at a
workflow journal. The journal was still on disk and was read in session 3. It holds **71 raw
findings**, which dedupe by file+quote to **54 distinct defects**: 6 blockers,
28 major, 20 minor.

Two things the distillation lost, and they matter:

1. **A severity class was dropped.** The reviewers marked 6 findings **blocker**; the word does
   not appear in the previous revision.
2. **A whole artifact was dropped.** Three of the nine reviewers audited `tools/questions-guard.mjs`
   and filed 14 findings against it, 4 of them blockers. The previous revision named that
   file only in the phrase "three lenses x three artifacts" and listed none of its findings.

This is the defect class the framework calls *closing the instance instead of the class*: **a fix is
judged BY THE LIST, so the list has to exist.** The full inventory is below, and the journal it came
from is session-scoped and now preserved here.

## Repro (deterministic)

```
node tools/verify-review-contour.mjs            # all blocks
node tools/verify-review-contour.mjs --only A1  # one block
```

Every block asserts the CORRECT behaviour, never the current one, so the same file re-verifies the
findings and then guards the fixes. **Proven red before green:** the file was run against `HEAD`
(a `git archive HEAD` copy of `tools/`) before a single line was changed. Of the 18 blocks the file
carries today, every one went red on the version it judges — except `I4b`, which is green on HEAD
too, and that is precisely what refutes its finding.

## What session 3 did

1. **Re-verified first, fixed second.** Nine major/blocker findings were reproduced mechanically
   against hostile fixtures before any edit. None of them was dropped as unreproducible; one
   sub-case inside C7 (a `Slack · #channel` target) refused correctly and is recorded as refuted.
2. **Fixed by class, not by instance.** A1+A2 are one defect and got one fix (the page walks the
   document instead of rebuilding a head and a tail). P8+P1 are one peel. C7/C8/C9 are three guards
   that could not fail, fixed as three refusals.
3. **Built `tools/verify-review-contour.mjs`** as part of the fix rather than after it (the bug's
   own fix plan, step 3) — 18 blocks, ~7 s, no browser needed.

Two defects were found *while* fixing and are recorded here because they belong to the same class:

- **the reviewers' `P8` check I wrote first could not fail** — a lazy `([\s\S]*?)</span>` stopped at
  the nested `<span class="oletter">`, so it passed on the broken version. Caught by running it
  against `HEAD` and expecting red.
- **`--only` in my own runner silently selected nothing** for a mixed-case id and exited 0. Both are
  now fixed; both are the exact shape the reviewers named (C11, "a check that cannot fail").

## Root cause / hypotheses

Not one cause; two, and both are about what verification was pointed at.

1. **The builders verified by COUNTING, and counting is blind to omission.** "3 cards, 12 options,
   0 leaked markers" proves what IS on the page and says nothing about what is missing from it.
2. **The invariants were implemented at the point they are STATED and not at the point they are
   USED.** `isWaiting` read a status line nobody writes; the summary counted a payload nobody
   compared to disk; the lock keyed a run rather than a document. Each is locally sensible and
   globally false.

A third cause is visible now that the whole list exists: **several guards were written as regexes
over the owner's language and never executed against it.** Four of the 14 `questions-guard.mjs`
findings are the same rake — `\w` is ASCII-only in Node even under `/u`, which the file's own header
warns about three lines above the code that commits it.

## The blockers are closed. What is left, and the owner's ruling on it

**All 6 blockers are fixed and guarded** (session 3, second pass):

1. ✅ **`review-gate.mjs` — nothing ever wrote `decision.artifacts`,** so the gate's only reachable
   verdict for a contour-recorded approval was a refusal, forever. Two halves, both closed:
   `core.writeDecision` now **merges** instead of rewriting the file whole, so a hand-authored
   artifact approval survives the owner's next answer; and the refusal itself now says what the
   page does and does not record, and prints the exact `artifacts` block to write. The approval
   stays hand-authored ON PURPOSE — approving a SEND is a different act from answering a question,
   and deriving one from the other would be a send nobody authorized. Guard: block `GATE`.
2. ✅ **`questions-guard.mjs` — four Cyrillic-blind patterns.** `\w` is ASCII-only in Node even under
<!-- owner-review:allow because=цитата шаблона сторожа как доказательство находки, а не вопрос владельцу -->
   `/u`, so «Вопросы владельцу», «Нужно ваше решение», «Владелец, подтвердите» and every form of
   «развилка» walked straight past a guard that then reported ЧИСТО. Measured before the fix: **13
   of 18 real owner-questions invisible.** Now `\p{L}`, plus the nominative stem the address case
   actually uses. Guards: `G1a`–`G1c`; `G1d` holds the no-false-alarm baseline (G9).

The owner's ruling on the rest, 2026-08-10: **"чини явные блокеры, и переходим к KAGO, срать на
леса"**. So the remaining 30 findings are PARKED, not scheduled. The list below stays
because it is a list — a future session picks any row up cold. The one operational consequence to
know while they are parked:

> **`send-upstream.mjs` has never delivered anything and is not on the happy path.** Upstream KAIF
> tickets are filed BY HAND, as KAIF#7 was. Do not reach for the sender until its remaining major
> findings are closed — chiefly `repo` and `title` living OUTSIDE the approved hash, and the
> timeout that asserts "no delivery happened" when it cannot know.

When work resumes here, the order is: the sender's majors → the page's majors (the silence clock
starting before the page loads · `process.exit(0)` on the ALREADY-OPEN branch meaning "recorded" to
a waiting agent · a partial write reported as "nothing was written" · `refreshQueue` rewriting the
whole queue from one run's narrow list) → the minors. Every one gets a block in
`tools/verify-review-contour.mjs`, proven red first.

## Full inventory — 54 distinct findings

Deduped by file + quoted line from 71 raw findings across nine reviewers. `why` is trimmed to
its first ~420 characters; the reviewers' full text lives nowhere else, so what is here is what
survives. ✅ fixed in session 3 · ⚪ refuted · 🔴 open.

Open by severity: **0 blocker · 15 major · 15 minor.**

#### `tools/questions-guard.mjs` — 14 findings, 10 still open

- ✅ **blocker** · rake 7 (also C4 rule 5) · seen by 2 lens(es) · **FIXED:** G1a — \p{L}, not \w
  - quote: `{ re: /вопрос\w*\s+(?:к\s+владельцу|для\s+владельца|владельцу)(?!\p{L})/iu, why: 'заголовок «вопросы владельцу»' },`
  - why: The file's own head comment (line 23) promises «every letter class is \p{L} with the `u` flag; \w and \b stay ASCII-only in Node and a guard written with them silently misses its own language» — and then uses \w in five live patterns (lines 73, 74, 101, 102, 103). This is not a comment-only implementation of rake 7, it is the inverse: the id is invoked in prose while the code commits the exact rake. Measured on the r
- ✅ **blocker** · rake 7 / G1 (sign b) · seen by 3 lens(es) · **FIXED:** G1b — \p{L}, not \w
  - quote: `{ re: /(?:нужн\w+|требуетс\w+|не\s+хватает)\s+(?:ваш\w+|решени\w+\s+владельца|ответ\w*\s+владельца|подтвержден\w+\s+влад`
  - why: Every branch of this rule except one requires \w+ to consume a Cyrillic suffix, which it cannot. Executed: 'нужно ваше решение' → MISS, 'нужно решение владельца' → MISS, 'требуется подтверждение владельца' → MISS, 'не хватает ответа владельца' → MISS, 'не хватает слова владельца' → MISS. The only string that fires is the ungrammatical 'не хватает ответ владельца' → HIT. So the whole «запрос решения владельца» sign — 
- ✅ **blocker** · G1 (sign b — an address at the START of a line) · seen by 3 lens(es) · **FIXED:** G1c — the nominative «владелец» is matched at last
  - quote: `{ re: /^владельц[ую]?\s*[,:]|^владельц[ую]?\s+[—–-]\s/iu, anchored: true, why: 'обращение «Владелец, …»' },`
  - why: The pattern cannot match the example named in its own `why` string. The Russian nominative — the case an address actually uses — is «владелец», with no soft sign; the stem «владельц» occurs only in oblique cases. Executed: 'Владелец, подтвердите частоту.' → MISS, 'Владелец: подтвердите частоту.' → MISS, 'Владелец — подтвердите.' → MISS; only 'Владельцу, подтвердите.' (dative, which nobody writes as an address) → HIT.
- ✅ **blocker** · G1 · seen by 1 lens(es) · **FIXED:** G1a — \p{L}, not \w
  - quote: `{ re: /развилк\w*\s+(?:для\s+владельца|к\s+владельцу|владельцу)(?!\p{L})/iu, why: 'заголовок «развилки для владельца»' }`
  - why: `\w` is ASCII-only in Node even under `u` — the exact rake the file's own header claims to have avoided (line 23: «\w and \b stay ASCII-only in Node and a guard written with them silently misses its own language»). `развилк` is followed by a Cyrillic vowel in EVERY real Russian form, so `\w*` matches empty, `\s+` then meets «а»/«и»/«е» and fails. Measured on the built file: `Развилка для владельца` ✗, `Развилки для в
- 🔴 **major** · G2 (debt baseline / ratchet) · seen by 2 lens(es)
  - quote: `const BASELINE_PATH = resolve(INTERVIEWS_DIR, 'decisions', 'guard-baseline.json');`
  - why: The builder reports this file as a delivered artifact — «interviews/decisions/guard-baseline.json — the frozen debt (1 item), written by the guard's own --freeze» — and reports the final run as «ИТОГ: ЧИСТО · ДОЛГ: 1». Neither reproduces. interviews/decisions/ contains only queue.json and .review-lock-interview_001_harness_boundaries.json; guard-baseline.json does not exist on disk (and is not gitignored — .gitignore
- 🔴 **major** · I20 · seen by 1 lens(es)
  - quote: `out.push(' · туда: ни одного вопроса без ответа.');`
  - why: `listInterviews` returns `[]` when the directory is absent (review-core.mjs: `if (!existsSync(dir)) return [];`), so a renamed, moved or not-yet-created `interviews/` makes the guard PRINT a positive all-clear on the outbound leg and exit 0. Proven on a fixture root with no `interviews/`: output was «· туда: ни одного вопроса без ответа.» followed by «ИТОГ: ЧИСТО», exit 0. The asymmetry is self-indicting: eight lines
- 🔴 **major** · G1 · seen by 1 lens(es)
  - quote: `if (RE_FENCE.test(raw)) { inFence = !inFence; continue; }`
  - why: A bare toggle with no balance check, no fence-kind tracking and no end-of-file assertion. `RE_FENCE` matches ``` and ~~~ interchangeably, so a `~~~` line inside a ```-fence flips the state early and the file's real closing ``` flips it back ON — everything after that block is silently skipped. Proven: a document whose ```-block contains a `~~~` line, followed by `## Вопрос владельцу`, returns 0 findings; the same doc
- 🔴 **major** · G1 · seen by 2 lens(es)
  - quote: `try { text = readFileSync(full, 'utf8'); } catch { text = ''; }`
  - why: A file the guard cannot read becomes an EMPTY document, is scanned clean, and is still counted in `filesScanned` — the header line «просмотрено 33 файлов .md» then asserts coverage the run did not have. Its sibling one function up is worse: `try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }` drops an entire subtree with no diagnostic and no count. On Windows a long path, a lock, or an ACL
- 🔴 **major** · I9 · seen by 1 lens(es)
  - quote: `out.push(' · туда: ${w.file} — ${w.open} из ${w.total} без ответа (${w.ids.join(', ')}), статус: ${w.status ?? 'не указа`
  - why: The outbound leg reports COUNT and never AGE, and `ok: fresh.length === 0` means an open question can never change the verdict. A question raised two minutes ago and one hanging thirteen days print identically, and both end «ИТОГ: ЧИСТО», exit 0, forever. That is precisely the failure the tool's own header names as its reason to exist (lines 7-8: «a guard surfaced two questions nobody saw, hanging 5 and 13 days»), an
- 🔴 **major** · I20 · seen by 1 lens(es)
  - quote: `const re = /[^\s"'<>|,;()\[\]]+\.(?:md|mjs|js|json|txt|ps1|psm1|yml|yaml|cu|c|h|ts)/giu;`
  - why: Ordered alternation truncates real targets: `js` is tried before `json`, and `h` before any longer h-extension, so the parser silently rewrites the declared path. Measured: targetPathsOf('cfg/settings.json') -> ["cfg/settings.js"], targetPathsOf('interviews/_pages/interview_001.html') -> ["interviews/_pages/interview_001.h"], targetPathsOf('report.jsonl') -> ["report.js"]. Reproduced end-to-end on a fixture where `cf
- 🔴 **minor** · G1 (two strong signs) · seen by 2 lens(es)
  - quote: `// Sign (b): an address at the START of the line. Headings are excluded here so one line is`
  - why: Heading lines are tested ONLY against QUEUE_HEADING_PATTERNS and never against OWNER_ADDRESS_PATTERNS, so an address written as a heading escapes both signs: '## Прошу подтвердить выбор варианта B' and '## Нужно решение владельца' produce no finding, while the same text as a body line does. G1 scopes sign (b) to 'an address at the START of a line', and a heading is the strongest possible start-of-line position. The s
- 🔴 **minor** · G1 (exceptions: lines that already point to the place of questions) · seen by 1 lens(es)
  - quote: `if (RE_POINTER.test(block)) continue;`
  - why: G1 scopes the pointer exception to LINES ('lines that already point to the place of questions'); the implementation scopes it to the whole SECTION block, so one `interviews/…` link anywhere in a section excuses every owner-addressed line under that heading. On live data this already swallows a real question: the `-lgc` bullet under STATUS.md:85 («Спросить до первой записи через `-lgc`») is excused by the interview li
- 🔴 **minor** · G1 · seen by 1 lens(es)
  - quote: `const RE_POINTER = /interviews\/|(?:интервью|interview)\s*[#№_-]?\s*\d/iu;`
  - why: Wider than the disclosed section-wide trade-off in two ways. (1) Any mention counts, including a historical one about a DIFFERENT, closed interview: a section containing «упоминание: интервью 001 закрыто в прошлом году» silences an owner question 200 lines below it — proven, MISSED vs CAUGHT for the same text without that line. (2) For a document with no headings, `blockAt` returns the whole-file preamble, so one `in
- 🔴 **minor** · G10 · seen by 1 lens(es)
  - quote: `const freeze = argv.includes('--freeze');`
  - why: argv is never validated — the CLI only asks `includes()` three times, so any unrecognized flag is silently accepted. Reproduced: `node tools/questions-guard.mjs --frezee --bogus` prints the full clean report ending `ИТОГ: ЧИСТО. Новых нарушений нет.` and exits 0. The owner who typos `--freeze` is told the run was clean and believes the ratchet is armed when nothing was written — which is consistent with the state act

#### `tools/review-gate.mjs` — 7 findings, 5 still open

- ✅ **blocker** · I4 · seen by 2 lens(es) · **FIXED:** GATE — writeDecision merges, so a hand-authored approval survives; the refusal now names the truth
  - quote: `const entry = decision.artifacts && decision.artifacts[id];`
  - why: Nothing in this repository ever writes `decision.artifacts`. The contour's only decision producer is review.mjs → recordDecision(), whose record is verbatim `const record = {` / `kind: d.isNotice ? 'notice' : 'interview',` / `document: d.name,` / `by,` / `at,` / `at_human: human,` / `comment: docComment,` / `answers,` / `};` (tools/review.mjs:1201-1209) — no `artifacts` key, and `grep -ni "artifact|артефакт" tools/re
- 🔴 **minor** · I10 · seen by 1 lens(es)
  - quote: `console.error('ОТКАЗ: ${verdict.reason}');`
  - why: The refusal is one line; the approval below it prints four (document, artifact, body, sha-256). On drift the owner gets two 12-character hashes and no path — yet the verdict object built at line 279 already carries `document`, `bodyPath` and `artifact`, and they are discarded. He is told his approval is void and left to find which file changed himself. A refusal the human cannot act on costs the same hour the skill s
- 🔴 **minor** · I10 · seen by 1 lens(es)
  - quote: `return refuse('в голове документа нет блока метаданных (fenced yaml) — ${docPath}');`
  - why: `const HEAD_LINES = 60;` bounds where a fenced yaml block is looked for, and that bound appears nowhere in the message. A document whose metadata block starts at line 61 — a long title, a preamble, a status table — is told there is NO block while the owner is looking straight at one. He then debugs a document that is correct. The refusal states something false about his file instead of naming the rule it applied.
- 🔴 **minor** · I2 · seen by 1 lens(es)
  - quote: `const who = decision.by ? '${decision.by}' : 'владелец';`
  - why: A decision record with no `by` and no `at` passes the gate and is announced as `одобрено (владелец, без отметки времени)`. The gate is fail-closed on nine conditions and fail-open on provenance: it asserts to the console that the owner approved, over a record no owner signed. I2 and P4 make `by` the thing that keeps the archive readable months later — 'remove the QUESTION, not the RECORD'. Since a hand-written decisi
- 🔴 **minor** · C1 · seen by 1 lens(es)
  - quote: `// What DOES live here is parseMetaBlock(): reading the document's metadata block is a different`
  - why: C1 names the core as the home of parsing and states that 'EVERY consumer — the page, the gate, AND the guard — parses documents through this one core'. The metadata block is not an incidental read: it is the SENDING CONTRACT (`body_file`, `target`, `format`), and the page must parse the same block to compute and record the `artifacts.<id>.sha256` this gate verifies. No second truth exists TODAY — `tools/review.mjs` h
- ⚪ **minor** · I4 · seen by 2 lens(es) · **REFUTED:** I4b — the artifact-level check refuses; omission authorizes nothing
  - quote: `if (decision.status && String(decision.status) !== 'approved') {`
  - why: The report lists 'document status ≠ approved' among the conditions the gate refuses on, but the code refuses only when a document-level status is PRESENT and different; an absent, empty or null `status` skips the check. In practice the per-artifact `status !== 'approved'` check carries the weight and the name contract defines no document-level status field, so this is not an open door — but the claimed refusal set is
- 🔴 **minor** · I4 · seen by 1 lens(es)
  - quote: `if (dash && listKey) {`
  - why: The yaml subset silently drops input in a way the file's own doc-comment denies: it claims "Anything richer is not supported and yields no artifacts", but a nested list inside an artifact item does not yield no artifacts — it mints a phantom item and orphans the rest. Any `- ` line at ANY depth opens a new item of the enclosing list, and the following keys, now at shallower indent, are re-read as top-level. Observed 

#### `tools/review.mjs` — 21 findings, 10 still open

- ✅ **blocker** · I2 · seen by 1 lens(es) · **FIXED:** B4 — the summary is built from applyAnswersToDocument's report
  - quote: `touched.push(d.name + ' — ' + (n ? ('ответов: ' + n) : 'только комментарий'));`
  - why: The success message the owner reads is computed from what the page SENT, never from what landed on disk. `n` counts `answers` in memory; the actual write is `core.applyAnswersToDocument`, which skips every question whose answer-field line does not exist (`if (q.answerLine !== null) absolute.push({ q, line: i + q.answerLine });`). Reproduced twice on scratch copies: (a) a question with options but no `**Ответ:**` plac
- 🔴 **major** · I12 · seen by 1 lens(es)
  - quote: `'function saveDraft(){ try { W.localStorage.setItem(dkey(), JSON.stringify(state)); } catch(e){} }',`
  - why: The one empty catch in the file sits on the insurance mechanism itself. If localStorage is unavailable (InPrivate window, an Edge/Chrome site-data policy, or quota exceeded on a batch page carrying long answers) every keystroke's draft write fails and nothing anywhere reports it — no status line, no console, no flag on the page. The page meanwhile asserts the opposite in two places: «Не закрывайте страницу: ваш текст
- ✅ **major** · I13 · seen by 3 lens(es) · **FIXED:** I13 — the pulse stops on save (fixed by reading, no browser harness)
  - quote: `' if (C.serve){ pulse(); W.setInterval(pulse, C.pulseMs); }',`
  - why: The pulse interval is never cleared and `pulse()` has no `saved` check, while the server deliberately dies `DEF3_DEATH_AFTER_RECORD = 2500` ms after answering /save. So within at most 15 s of a SUCCESSFUL record every page still on screen paints the red warning «Сервер молчит (нет ответа). Не закрывайте страницу: ваш текст сохранён в браузере…» directly beside the green «Записано… закройте меня, пожалуйста». Two fals
- 🔴 **major** · I9 · seen by 1 lens(es)
  - quote: `let lastPing = Date.now();`
  - why: The silence clock starts at server construction, not at the first /alive, so the watch cannot tell 'the page has not opened YET' from 'the page is dead'. Verified: `node tools/review.mjs q.md --no-open --no-signal --timeout 1` → «ИТОГ: страница закрыта без ответа / код выхода 3» with no page ever loaded. On defaults that is DEF6_SILENCE_MS 180 s plus one 15 s tick ≈ 195 s. It bites precisely on the path where the too
- 🔴 **major** · I25 · seen by 1 lens(es)
  - quote: `process.exit(0);`
  - why: This is the «УЖЕ ОТКРЫТО» branch. The file's own contract states `0 decision recorded (or a notice marked read — I37)` and I31 makes process termination the agent's answer channel. Here the tool prints three console lines no agent parses and then exits with the same 0 that means 'the owner decided'. An agent re-raising the page while a window is live — which I8 makes its duty — receives 'recorded' and proceeds as tho
- 🔴 **major** · I10 · seen by 1 lens(es)
  - quote: `res.end(JSON.stringify({ ok: false, error: 'запись не прошла: ' + (e && e.message ? e.message : e) }));`
  - why: recordDecision performs several unprotected writes per document — applyAnswersToDocument, then appendDocumentComment, then writeDecision — and on a batch page repeats them per document. A throw on any write after the first (EPERM/EBUSY from antivirus or a sync client, a full disk, an unwritable archive dir) unwinds to this handler, which reports a flat 'nothing was written' and opens the rescue ring under «НЕ СОХРАНИ
- ✅ **major** · I1 · seen by 1 lens(es) · **FIXED:** A1 — splitDocument walks the document
  - quote: `const preamble = lines.slice(start, qLines[0]).join('\n').trim();`
  - why: splitAround keeps only the head (before the first question) and the tail (from the first non-question heading after the LAST question). Everything BETWEEN question blocks is silently dropped and never reaches the page. Reproduced: I built interviews/interview_900_split.md with a paragraph «ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ МЕЖДУ ВОПРОСАМИ» sitting between Q1 and Q2, ran the tool, and the produced HTML contains it 0 times (`MID p
- ✅ **major** · I1 · seen by 1 lens(es) · **FIXED:** A2 — same fix; there is no "epilogue scan" any more
  - quote: `let epiStart = lines.length;`
  - why: The epilogue is found ONLY by scanning for a heading after the last question. If the document ends in plain prose with no further heading, epiStart stays at lines.length and the epilogue is the empty string — the whole tail vanishes. Same reproduction: the trailing paragraph «ХВОСТ БЕЗ ЗАГОЛОВКА — тоже должен быть виден.» appears 0 times in the generated page (`TAIL present: false`). interview_001 happens to end with
- ✅ **major** · P8 · seen by 1 lens(es) · **FIXED:** P8 — every paragraph is peeled, not only a single one
  - quote: `if (/^<p>[\s\S]*<\/p>$/u.test(html) && html.indexOf('<p>', 1) === -1) {`
  - why: inlineMd peels the wrapping <p> only when the renderer produced exactly ONE paragraph. core.renderMarkdown emits one <p> per SOURCE LINE, so any option whose markdown text is hard-wrapped comes back as a stack of <p> blocks and the peel is skipped — the block HTML is then concatenated straight after `<span class="oletter">A.</span>` inside `<span class="otext">`. Measured on the builder's own probe output of the owne
- ✅ **major** · I7 · seen by 1 lens(es) · **FIXED:** B5 — the contour counts, the status still closes
  - quote: `if (d.doc.statusIsWaiting === true) return true;`
  - why: isWaiting is bound to the document's `**Status:**` line, and nothing in the contour ever writes that line (grep for Status/Статус across tools/ finds only readers in review.mjs and a reporter in questions-guard.mjs). Reproduced against the live document: at 23:23:45 the contour recorded answers for all three questions; at 23:24 `node tools/review.mjs interviews/ --batch --no-serve` still collected it — «СОБРАНО: 1 до
- ✅ **major** · I2 · seen by 1 lens(es) · **FIXED:** B4 — same defect, same fix
  - quote: `const n = Object.values(answers).filter((a) => a.choice || a.text).length;`
  - why: The success summary is counted from the PAYLOAD, never from what actually landed in the md, so the contour reports a decision it did not record. `core.applyAnswersToDocument` only writes questions whose `answerLine !== null` (it maps `absolute.push({ q, line: i + q.answerLine })` and skips the rest) — a question with no `**Ответ:**` field is silently dropped. Proved end-to-end on a scratch interview whose Вопрос 1 la
- 🔴 **major** · I8 · seen by 1 lens(es)
  - quote: `for (const d of model.docs) {`
  - why: `refreshQueue` is the function whose own docstring says an agent woken by the termination «must be able to read "how many are left" from the state file rather than guessing» — but it re-reads only the documents of THIS run and then calls `syncQueue(model.dir, fresh)`, which rewrites `queue.json` from that same narrow list. Proved on a scratch directory holding three interviews, two of them `**Status:** 🔴 ждёт владел
- ✅ **major** · I29 · seen by 1 lens(es) · **FIXED:** B6 — one lock per document
  - quote: `const key = opts.batch ? '_batch' : docs[0].key;`
  - why: I29 is «One document — one window», but the lock (`lockPath(decisionsDir, key)`) is keyed by the RUN, not by the document: a batch run always locks `_batch`, so it never collides with a single-document run over a document it contains. Proved by launching both against the same scratch directory: `[BATCH] СТРАНИЦА: http://127.0.0.1:51148 · ДОКУМЕНТЫ: interview_911_other.md, interview_912_other.md` and, 0.9 s later, `[S
- 🔴 **minor** · I12 · seen by 1 lens(es)
  - quote: `' } catch(e){ return 0; }',`
  - why: loadDraft's failure and 'there was no draft' are the same value. A draft that cannot be read — blocked storage, or JSON truncated by the very crash the draft insures against — returns 0, and boot only reveals the notice `if (r && restored > 0)`, so the page says nothing at all. The owner cannot learn that saved work existed and was lost, and will retype from memory believing nothing was ever there. A failed restore d
- 🔴 **minor** · P4 · seen by 1 lens(es)
  - quote: `else if (a === '--by') o.by = argv[++i];`
  - why: No value validation, unlike the unknown-flag branch two lines below which throws. `--by` given last yields undefined: the page footer renders «отвечает undefined», applyAnswersToDocument stamps `by="undefined"` into the owner's document, and in the decision record JSON.stringify drops the `by` key entirely — the authorship of the owner's decision vanishes without a word. P4 is 'the page never ASKS, the server always 
- 🔴 **minor** · P3 · seen by 1 lens(es)
  - quote: `' if (ev.key === " " || ev.key === "Enter"){ ev.preventDefault(); act(lab, "toggle"); }',`
  - why: Only Space and Enter are intercepted. The native radios are visually erased by `.opt input{position:absolute;width:1px;height:1px;opacity:0;margin:0;pointer-events:none}`, so an owner using the standard radiogroup keys ↓/→ flips the invisible native `checked` while `state` and the visible `.sel` stripe stay on the previous option: nothing moves on screen, nothing is recorded, and no message explains why the keyboard 
- 🔴 **minor** · C11 · seen by 1 lens(es)
  - quote: `if (!isAscii(ps)) { console.log(' голос: команда не ASCII — отменяю'); return; }`
  - why: A check that cannot fail. `ps` is assembled immediately above from six literal ASCII fragments and no variable, so isAscii(ps) is a tautology — the same is true of the `isAscii(beepCmd)` guard, whose input is built from the numeric constants in DEF1_BEEPS. The report cites «both command lines verified ASCII» as evidence, but the property being guarded (the owner's Russian phrase riding the command line) was already d
- 🔴 **minor** · C11 · seen by 1 lens(es)
  - quote: `' if (inp && inp.disabled) return;',`
  - why: renderQuestion never emits a disabled input — the only occurrences of the string `disabled` in the produced page are the `.btn:disabled` CSS rule and the save-button assignments in PAGE_JS (5 occurrences, 0 of them an attribute on an option). The branch is unreachable from the markup this page builds, so P3 proof #7 in the report («disabled option→no-op and no preventDefault») exercises dead code and adds no coverage
- ✅ **minor** · I29 · seen by 1 lens(es) · **FIXED:** I29b — .gitignore now names the lock
  - quote: `return join(decisionsDir, '.review-lock-' + key + '.json');`
  - why: The lock is written as `.review-lock-<key>.json`, but .gitignore only excludes `interviews/decisions/*.lock` while its own comment states that `interviews/decisions/*.json` is «deliberately NOT ignored» because those are the owner's decision records. So a lock — a file whose entire content is a pid and a loopback port for one machine at one moment — is tracked by git in a repository the project documents as public. T
- ✅ **minor** · I15 · seen by 1 lens(es) · **FIXED:** I15 — the queue is stamped only by a run that serves
  - quote: `row.lastShownAt = at;`
  - why: `syncQueue(dir, docs)` runs in `main()` BEFORE the `if (!opts.serve)` branch, so a `--no-serve` build — the very command that ends by printing `RENDER IS NOT YET A SHOW` — stamps `lastShownAt` into `interviews/decisions/queue.json` for a page nobody was ever shown. The builder disclosed that `--no-serve` writes the queue; what is not disclosed is that the field it writes asserts a SHOW. The queue is the contour's sta
- ✅ **minor** · P1 · seen by 1 lens(es) · **FIXED:** P8/P1 — the same peel
  - quote: `out.push('<span class="otext"><span class="oletter">' + attr(o.letter) + '.</span> ' + inlineMd(label) +`
  - why: `inlineMd` peels the wrapping `<p>` only when the render is a SINGLE paragraph, and `core.renderMarkdown` emits one `<p>` per source line. Every option in the live interview wraps, so the emitted markup is e.g. `<span class="otext"><span class="oletter">A.</span> <p>(Рекомендовано) Автоматический гейт считает …</p>\n<p> способность и стабильность …</p>` — five block paragraphs inside an inline `<span>` that sits outs

#### `KAIF_UPDATES/KAGO_KAIF_2.2_INSTALL_REPORT.md` — 1 findings, 1 still open

- 🔴 **major** · G2 · seen by 1 lens(es)
  - quote: `<!-- owner-review:allow because=historical record of a queue that is CLOSED: both tickets were delivered on the owner's `
  - why: The builder reports this finding as the frozen baseline debt and states "final live run is `ИТОГ: ЧИСТО · ДОЛГ: 1`" and that `interviews/decisions/guard-baseline.json` was "written by the guard's own `--freeze`". Neither is on disk. The file does not exist — `interviews/decisions/` holds only `queue.json` and `.review-lock-interview_001_harness_boundaries.json` — and the documented command prints `ДОЛГ: 0 (файл долга

#### `lib/review-core.mjs` — 1 findings, 0 still open

- ✅ **major** · I1 · seen by 1 lens(es) · **FIXED:** A3 — own line + tolerant matcher + exact sweep
  - quote: `const fence = line.match(/^ FENCE(\d+) $/u);`
  - why: The fence placeholder is only recognised when it occupies the whole line, but the substitution above it replaces a fenced block wherever it sits — including indented inside a list item, where the placeholder ends up mid-line. The line then falls through to the paragraph branch and the owner is shown the literal token instead of the code, while the code itself is dropped. Reproduced end-to-end through the page, not ju

#### `tools/send-upstream.mjs` — 10 findings, 4 still open

- ✅ **major** · I2 · seen by 3 lens(es) · **FIXED:** GATE — the page no longer rewrites the decision wholesale
  - quote: `if (entry.delivered && entry.delivered.url) {`
  - why: The only guard against filing the owner's ticket twice lives inside `<doc>.decision.json` — a file the page rewrites WHOLESALE. review.mjs:1227 calls `core.writeDecision(d.file, record)`, and review-core.mjs:294 is ` writeFileSync(p.decision, body, 'utf8');` with the record shown in the blocker above, which carries no `artifacts` key. So the owner answering one more question, or leaving one comment, on that same docu
- ✅ **major** · C6 · seen by 1 lens(es) · **FIXED:** GATE — recordDelivery merges instead of writing a stale snapshot
  - quote: `record.artifacts[artifactId].delivered = delivered;`
  - why: `record` is `verdict.decision` — a snapshot JSON.parse'd at the START of the run, before `gh` ran under a 120 s deadline. recordDelivery then serializes that whole stale snapshot back over `<doc>.decision.json` (line 239). Any decision the owner records on the page during the send window — a new answer, a comment, a rejection of another artifact — is silently overwritten by a record read minutes earlier. There is no 
- 🔴 **major** · I10 · seen by 1 lens(es)
  - quote: `console.error(' Решение не тронуто: доставки не было.');`
  - why: This line is asserted as fact on EVERY non-zero outcome, including the timeout. spawnSync with `timeout: GH_TIMEOUT_MS` returns `status: null` with an ETIMEDOUT error after SIGTERM-ing a `gh` that may have already created the issue on GitHub. The tool then tells the owner that no delivery happened — something it cannot know — and writes no `delivered` mark, so the next run files a duplicate. Compounding it, only ENOE
- 🔴 **major** · I3 · seen by 2 lens(es)
  - quote: `const args = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', verdict.bodyPath];`
  - why: Only `--body-file` is covered by the approval. `repo` comes from `repoFromTarget(artifact.target)` and `title` from `titleFor(...)`, whose first branch is line 75 ` if (artifact && artifact.title) return String(artifact.title).trim();` — both read LIVE from the document's metadata block, which is not part of `hashBody(bodyPath)`. Edit the block after the owner clicks approve and the gate still passes: the approved te
- 🔴 **major** · I4 · seen by 1 lens(es)
  - quote: `const written = recordDelivery(docPath, verdict.decision, id, {`
  - why: This is the only irreversible moment in the tool — the issue already exists upstream — and it is the one call with no try/catch anywhere in its chain. recordDelivery does mkdirSync + two writeFileSync with no guard, sendUpstream has no try/catch, main has none. A read-only decisions directory, EPERM, or a long path makes Node print a stack, `process.exit(main(...))` never runs, and the process exits 1 for a send that
- ✅ **major** · I2 · seen by 1 lens(es) · **FIXED:** C9 — the guard binds to `delivered`, not to its url
  - quote: `const url = (String(r.stdout || '').match(/https?:\/\/\S+/u) || [null])[0];`
  - why: The code explicitly anticipates a successful `gh` whose stdout carries no URL — line 211 falls back to printing the raw stdout, and line 215 writes `url: url || null`. But the double-send guard at line 160 is keyed on `entry.delivered.url` being truthy. So in exactly the case the author foresaw, `delivered` is written with `url: null`, the guard evaluates false, and the very next `--apply` files a second issue. The o
- ✅ **major** · C7 · seen by 2 lens(es) · **FIXED:** C7 — anchored, and a non-github host is refused
  - quote: `const m = t.match(/(?:https?:\/\/)?(?:www\.)?(?:github\.com[/:])?([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-`
  - why: No `^` anchor and the `github.com` prefix is OPTIONAL, so ANY target containing a slash is read as a GitHub repo. Probe: 'Slack · #team/product' -> 'team/product'; 'Telegram · @team/channel' -> 'team/channel'; 'https://gitlab.com/acme/secret-repo' -> 'gitlab.com/acme'; 'see draft at docs/drafts/letter.md' -> 'docs/drafts'; 'NOT-TO-SEND github.com/Attacker/Evil' -> 'Attacker/Evil'. Running the full sender on a fixture
- ✅ **major** · I4 · seen by 1 lens(es) · **FIXED:** C8 — an undeclared format is a refusal
  - quote: `if (artifact.format && !/issue|markdown|(^|[^a-z])md([^a-z]|$)/i.test(artifact.format)) {`
  - why: The second half of the addressee defence is skipped entirely when `format` is absent — `format` is optional (the sender itself prints `формат: не указан`) and the guard is bound to its presence. A missing declaration is doubt, and by this module's own doctrine ("Any doubt = refusal") it must refuse, not proceed. FAILURE: a draft for Slack/Telegram/e-mail is written without a `format:` line — perfectly legal in the me
- 🔴 **minor** · I4 · seen by 1 lens(es)
  - quote: `const flags = new Set(argv.filter((a) => a.startsWith('--')));`
  - why: `flags.has('--apply')` is an exact match and every other `--` token is swallowed without a word — the tolerance documented for `--no-serve` extends to typos. `--apply=true`, `--Apply`, `--aply` all yield a DRY RUN that returns `{ code: 0, ok: true }` (line 194). The screen does say СУХОЙ ПРОГОН, so it is not fully silent to a watching human — but the exit code says success to a ritual or an autoloop, and the ticket t
- ✅ **minor** · I2 · seen by 2 lens(es) · **FIXED:** GATE — the archive copy never collides at second resolution
  - quote: `const archive = p.archiveFor(delivered.at);`
  - why: `delivered.at` is `isoLocal(now)` — SECOND resolution — and `archiveFor` builds the filename from it, so two writes inside one second land on the same file and the second silently overwrites the first. Observed in the double-send probe: both runs printed 'Копия в архиве: …\decisions\archive\doc--2026-08-09T23-25-25+03-00.json' — the same path twice. I2/C6 say the archive copy is never overwritten, and this function's

## Decisions made without the owner

- **Filing all findings as ONE document** rather than one per defect: they came from one review pass
  and group into classes. Carried over from the previous revision, still holds.
- **`isWaiting` was split from the document status** (B5). The contour now answers "has the owner
  anything left to click?" by counting, while `**Status:**` remains the AGENT's truth about closure
  — because closing an interview means propagating answers to their declared targets first, which is
  not something the contour can know. The protective direction of parsing rule 4 is intact: a status
  that says closed still closes the document.
- **An undeclared `format` is now a refusal** (C8), not a pass. No document in the repository
  declares an artifact today, so nothing breaks; the alternative was guessing what the author meant.
- **The review-gate "absent document-level status" finding was closed as REFUTED**, with a check
  (`I4b`) that proves a rejected artifact is still refused when the field is missing.
- **`queue.json` was reverted, not committed**, after a `--no-serve` render stamped a `lastShownAt`
  for a page nobody was shown — the I15 defect producing a false record while being fixed.

## Noticed later — NOT taken into work (the contour stays parked)

- **2026-08-14 · `npm run questions` is PERMANENTLY RED, and all three of its hits are false.** Its
  own debt file does not exist (`ДОЛГ: 0 (файл долга не заведён)` · `interviews/decisions/guard-baseline.json`),
  so every hit counts as NEW on every run. The three: two are the SECTION HEADERS of a queue whose
  body says «Открытых вопросов владельцу — НОЛЬ» (`STATUS.md`, and the chronicle's copy of the same
  heading in `PROJECT_HISTORY.md` — i.e. history), and one is the words «Владелец, …» inside
  `assets/logo/README.md`. Verified pre-existing: `git grep -n "Ждёт решения владельца" HEAD` finds
  all of them at `HEAD`. **Why this is worth a line rather than a fix:** a gate that is red on a
  clean tree teaches its reader that red means nothing, which is the one failure a guard cannot
  survive (`GPU_TUNING_RAILS.md` STOP-line 6). The cheap remedy is to WRITE the baseline once so the
  ratchet has something to ratchet from — it is the contour's own design, and the contour is parked
  by the owner, so it waits with the other 30.

## Links

- Built by the workflow `wf_37fb46cf-7ad` (12 agents, 3 builders x 3 verification lenses).
- The contour's contract: `.claude/skills/owner-reviews/SKILL.md`.
- Field report on building it: [KAIF#7](https://github.com/MikalaiKryvusha/KAIF/issues/7).
- The guard: `tools/verify-review-contour.mjs`.
