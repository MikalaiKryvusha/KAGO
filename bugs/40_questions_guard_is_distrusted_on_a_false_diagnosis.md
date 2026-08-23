# Bug 40 — the questions guard is written off as «all findings false», and the write-off is itself wrong: 2 of its 9 are REAL

**Status:** 🔬 RESEARCH-ONLY — diagnosed by running it and classifying every finding by hand; the
three defect classes are named with their discriminators, and the two REAL findings are named with
their addresses. No code changed yet.
**Version/build:** `main` @ `1cd5163` · **When/context:** found 2026-08-23 17:1x while taking the
backlog item `STATUS.md` records as *«починить сторож или снять его — сторож, которому не верят,
хуже отсутствующего»*

## Symptom — and the symptom is a BELIEF, not an output

`STATUS.md` says, of the mechanical guard for the place-of-questions rule:

> *«Механический сторож этого правила (`npm run questions`) в проекте считается нерабочим
> (`bugs/01`: краснеет всегда, все находки ложные), то есть правило держится на внимательности
> агента»*

**Measured 2026-08-23 17:1x by running it and reading all nine findings: «все находки ложные» is
FALSE. Seven are false, TWO ARE REAL** — and the project has been ignoring a guard that was pointing
at two genuine violations of a rule its own canon calls hard.

Worse, the ratio is not even bad. `AGENT_GUIDE.md` states the expectation for exactly this kind of
tool: *«a guard of a text rule runs ~10 false hits per real one»*. **This one runs 3.5 to 1** — four
times better than the canon's own bar — and was retired as broken.

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
| 8 | `researches/10_virtual_gpu_test_bench.md:356` | heading «forks for the owner» | ✅ **REAL** | `## 5. Open forks for the owner` — owner-level forks living in a research doc |
| 9 | `researches/12_ambient_melody_phrasing_and_rhythm.md:145` | heading «открытые вопросы» | ✅ **REAL** | `## 7. Открытые вопросы к владельцу` — same |

**Findings 8 and 9 are the exact defect the rule exists to catch**, and the project's own record shows
what it costs: `STATUS.md` carries the incident where a fork lived a day and a half in the tail of a
file and nowhere else, and the owner found it himself — *«Что за мной? Я даже не в курсе»*.

## Root cause — THREE classes, each with a discriminator that is mechanical

Not one bug. Three, and none needs an LLM to decide:

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

## A FOURTH defect, in the reporting rather than in the detection

The «ОБА ПЛЕЧА» section reports three interviews as *«2 из 2 без ответа (Q1, Q2)»* — and then prints,
on the same line, each one's own status: **✅ ЗАКРЫТО**, with the owner's verbatim answer beside it.
The guard cannot see an answer given as PROSE rather than in a `Q1:`/`Q2:` slot, so it counts a
closed, answered interview as fully unanswered. That is not a false positive of the rule; it is the
instrument contradicting itself inside one printed line, which is precisely what teaches a reader to
stop believing it.

## Fix plan (not started — the diagnosis is the deliverable of this pass)

- [ ] **1. Correct `STATUS.md` first, before any code.** The line «все находки ложные» is what
      retired the tool, and it is wrong. Correcting a belief costs one sentence; the two real
      findings have been ignored for as long as the sentence stood.
- [ ] **2. Close findings 8 and 9 as the rule requires** — move the forks of `researches/10` §5 and
      `researches/12` §7 into `interviews/`, or record them as already-decided with the decision.
      **These are real and they are the guard's actual output**; fixing the tool without acting on
      what it found would repeat the original mistake.
- [ ] **3. Class A — the speaker-colon-quote discriminator.** Largest class, smallest patch.
- [ ] **4. Class B — scope the chronicle out**, by the same rule the stamp guard already uses.
- [ ] **5. Class C — a line that cites a document is a reference, not a question.**
- [ ] **6. The fourth defect — read an interview's own status line** before calling its questions
      unanswered.
- [ ] **7. Prove each fix RED first** on the very finding it exists to reclassify, and keep findings
      8 and 9 GREEN-to-red: a patch that silences the two real ones has made the tool worse than
      retired.

## Decisions made without the owner

- **Nothing was fixed in this pass and nothing was moved.** The item was picked up with ~15 minutes
  left in an autonomous window; a half-applied patch to a guard nobody trusts would have been the
  worst of both states. A precise diagnosis is complete on its own and is what the next session needs.
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
