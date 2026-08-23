# Bug 40 — the questions guard is written off as «all findings false», and the write-off is itself wrong: 1 of its 9 is REAL

**Status:** 🟡 OPEN — **the real finding is CLOSED and class B is FIXED: 9 → 8 → 6 findings, each
step witnessed by the guard itself.** Classes A, C and D are named with their mechanical
discriminators and remain. The instrument is no longer «broken» or «working»: every line of its
output is now accounted for.
**Version/build:** `main` @ `1cd5163` · **When/context:** found 2026-08-23 17:1x while taking the
backlog item `STATUS.md` records as *«починить сторож или снять его — сторож, которому не верят,
хуже отсутствующего»*

## Symptom — and the symptom is a BELIEF, not an output

`STATUS.md` says, of the mechanical guard for the place-of-questions rule:

> *«Механический сторож этого правила (`npm run questions`) в проекте считается нерабочим
> (`bugs/01`: краснеет всегда, все находки ложные), то есть правило держится на внимательности
> агента»*

**Measured 2026-08-23 17:1x by running it and OPENING every one of the nine findings: «все находки
ложные» is FALSE. Eight are false, ONE IS REAL** — three unanswered questions to the owner, sitting
since 2026-08-22 in a research document where the rule says they may not sit, and which he has never
been shown.

**The ratio is not even bad.** `AGENT_GUIDE.md` states the expectation for exactly this kind of tool:
*«a guard of a text rule runs ~10 false hits per real one»*. **This one runs 8 to 1 — inside the
canon's own bar**, and it was retired as broken.

⚠️ **AND THE FIRST PASS OF THIS VERY DOCUMENT GOT THE COUNT WRONG — recorded rather than quietly
edited, because it is the same mistake one level up.** It listed `researches/10` §5 as a second real
finding on the strength of its HEADING, «Open forks for the owner». Opening the section shows its
entire body is the word **«None.»** — the heading DECLARES the absence of forks. A document whose
whole subject is «a wrong count retired a working instrument» carried, for ten minutes, a wrong count
of its own, arrived at exactly the way the guard arrives at its: by matching a heading instead of
reading what is under it (`BUG_FIXING_FRAMEWORK.md` → «a finding is not a finding until verified»).

## Forensics — every finding of axis G1, classified by hand

`npm run questions` → `[G1] вопрос владельцу вне interviews/ — новых: 9`. Exit code 0, verdict КРАСНО.

| # | address | what the guard called it | verdict | why |
|---|---|---|---|---|
| 1 | `AGENT_GUIDE.md:537` | question outside `interviews/` | ❌ false | the canon TEXT that states the rule |
| 2 | `PROJECT_HISTORY.md:1682` | «Владелец, …» address | ❌ false | the chronicle — the CLOSED past by definition |
| 3 | `PROJECT_HISTORY.md:2292` | queue heading «ждёт владельца» | ❌ false | same |
| 4 | `STATUS.md:834` | «Владелец, …» address | ❌ false | **a QUOTE of the owner**: `> Владелец, глядя на вторую смерть: «комп умирал постепенно…»` — he is the SPEAKER |
| 5 | `STATUS.md:936` | question outside `interviews/` | ❌ false | a REFERENCE to a question: `вопрос владельцу о demandPin (bugs/26 п. 5), а не дефект стенда` |
| 6 | `assets/logo/README.md:32` | «Владелец, …» address | ❌ false | a prose fragment: `владельцу, история выбора.` |
| 7 | `bugs/14…:28` | «Владелец, …» address | ❌ false | **a QUOTE**: `Владелец: «ты ни разу не протестировал твою остановку?»` |
| 8 | `researches/10_virtual_gpu_test_bench.md:356` | heading «forks for the owner» | ❌ false | the heading is `## 5. Open forks for the owner` and **the section's whole body is «None.»** — it DECLARES the absence |
| 9 | `researches/12_ambient_melody_phrasing_and_rhythm.md:145` | heading «открытые вопросы» | ✅ **REAL** | `## 7. Открытые вопросы к владельцу` holding **three unanswered questions** — the base note length (0.8 s at 75 BPM), whether the reverb needs a pre-delay, and whether an eight-move cycle carries an hour and a half |

**Finding 9 is the exact defect the rule exists to catch**, and the project's own record shows what it
costs: `STATUS.md` carries the incident where a fork lived a day and a half in the tail of a file and
nowhere else, and the owner found it himself — *«Что за мной? Я даже не в курсе»*. These three have
been sitting since 2026-08-22, and their parent is `homeworks/04_dashboard_sound_taste.md` —
i.e. **the taste class, where the owner's ear is not one witness among several but the only one**, so
they are exactly the kind of question that cannot be decided by the agent and must not be parked.

## Root cause — FOUR classes, each with a discriminator that is mechanical

Not one bug. Four, and not one of them needs an LLM to decide:

- **A. A QUOTE OF the owner is read as an address TO him** (findings 4, 7 — the largest class).
  The discriminator is present in the line: the owner's own words follow in quotation marks
  (`«…»` / `*«…»*`), i.e. the pattern is `Владелец…: «…»`, speaker-colon-quote. An address to him
  does not carry his speech.
- **B. The CLOSED PAST is scanned as if it were open** (findings 2, 3). `PROJECT_HISTORY.md` is by
  canon *«the closed past — the append-only chronicle»*; a question recorded there is a historical
  fact, not an open question, and the chronicle is never edited to match today. **This is the same
  shape the stamp guard already solved by scoping itself** (`AGENT_GUIDE.md`: *«a guard for this rule
  scopes itself by the stamp's OWN date; stamps dated before the adoption stay silent»*).
- **C. A REFERENCE to a question is read as a question** (findings 1, 5, 6). The canon that STATES
  the rule, and prose that MENTIONS a question, both trip it. Cheapest correct discriminator: the
  line must not itself be a citation — findings 1 and 5 both name a document (`bugs/26 п. 5`) or are
  the rule's own text.
- **D. A HEADING IS MATCHED WITHOUT READING WHAT IS UNDER IT** (finding 8 — and the class that fooled
  this document's own first pass). `## 5. Open forks for the owner` followed by the body «None.» is a
  section that OBEYS the rule, not one that breaks it. The discriminator is not subtle: read the
  section's body and require at least one question-shaped line in it. **This is the most expensive of
  the four**, because a heading match is what makes the tool look like it is reading documents when
  it is only matching titles.

## A FIFTH defect, and this one is in the REPORTING rather than in the detection

The «ОБА ПЛЕЧА» section reports three interviews as *«2 из 2 без ответа (Q1, Q2)»* — and then prints,
on the same line, each one's own status: **✅ ЗАКРЫТО**, with the owner's verbatim answer beside it.
The guard cannot see an answer given as PROSE rather than in a `Q1:`/`Q2:` slot, so it counts a
closed, answered interview as fully unanswered. That is not a false positive of the rule; it is the
instrument contradicting itself inside one printed line, which is precisely what teaches a reader to
stop believing it.

## ✅ Step 2 is DONE, and the guard itself witnessed it

The one real finding was closed the same hour: the three questions of `researches/12` §7 now live in
**`interviews/interview_011_ambient_theme_tempo_and_cycle.md`**, with the §5 context QUOTED INTO them
so the question is self-sufficient, with options and a price per option, and with an honest note on
Q1 that 0.8 s is a number ASSIGNED from the middle of the sources' range rather than measured.

**Observed, not claimed** — the same command, before and after:

| | `[G1]` findings | `researches/12` in the list | `PROJECT_HISTORY` in the list |
|---|---|---|---|
| at the start of the pass | **9** | yes | yes |
| after step 2 (the real finding closed) | **8** | **no** | yes |
| after step 4 (class B scoped out) | **6** | no | **no** |

That 9 → 8 is the whole proof this pass needed: the finding that disappeared is the one that was
real, and the eight that remain are exactly the four false classes below. **The guard is now a tool
whose entire output is understood, one line at a time** — which is a different state from both
«works» and «broken», and it is the state a fix can start from.

## Fix plan — steps 2 and 4 done; three classes remain

- [ ] **1. Correct `STATUS.md` first, before any code.** The line «все находки ложные» is what
      retired the tool, and it is wrong. Correcting a belief costs one sentence; the real finding
      went unseen for as long as the sentence stood.
- [x] **2. ✅ DONE 2026-08-23 17:2x — finding 9 closed as the rule requires** — the three questions of `researches/12` §7 go into
      `interviews/`, QUOTED INTO the question (the self-sufficiency rule), because two of the three
      are taste-class and only the owner's ear can answer them. **This is the guard's actual output
      and it is real**; fixing the tool without acting on what it found would repeat the original
      mistake in the other direction.
- [ ] **3. Class A — the speaker-colon-quote discriminator.** Largest class, smallest patch.
- [x] **4. ✅ DONE 2026-08-23 17:2x — class B scoped out.** `PROJECT_HISTORY.md` left the scan, by
      the same shape the stamp guard already uses (scope, not a suppression list — nothing to keep up
      to date). **Proved by REVERSE mutation, not only by the after-count:** delete the set's use in
      `collectMarkdown` and the findings go back to 8, returning exactly `:1682` and `:2292`. 8 → 6.
- [ ] **5. Class C — a line that cites a document is a reference, not a question.**
- [ ] **5a. Class D — a heading is not a finding until its BODY holds a question-shaped line.**
- [ ] **6. The fourth defect — read an interview's own status line** before calling its questions
      unanswered.
- [ ] **7. Prove each fix RED first** on the very finding it exists to reclassify, and keep finding 9
      RED throughout: a patch that silences the one real finding has made the tool worse than retired.

## Decisions made without the owner

- **Nothing was fixed in this pass and nothing was moved.** The item was picked up with ~15 minutes
  left in an autonomous window; a half-applied patch to a guard nobody trusts would have been the
  worst of both states. A precise diagnosis is complete on its own and is what the next session needs.
- **The first pass's own miscount was corrected IN PLACE and left VISIBLE, not silently edited.** This
  document argues that a wrong count retired a working tool; hiding its own would have made it an
  example of the thing it describes.
- **No threshold, no suppression list, no `# noqa`-style escape was added.** The canon allows explicit
  exceptions with the reason on the line; reaching for that before fixing the three classes would
  paper over a guard that is, measured, four times better than the canon's own bar for its kind.

## Links

- `bugs/01` — where the «all findings false» judgement is recorded; this document corrects it.
- `AGENT_GUIDE.md` → «The place of questions», and its own ~10:1 expectation for text-rule guards.
- `STATUS.md` → «❓ Ждёт решения владельца», which carries both the retirement sentence and the
  incident that proves the rule matters.
- `EXPERIENCE.md` EXP-0126 — a guard's value is (does it go red) × (does anyone run it); this is the
  third factor: **does anyone believe it.**
