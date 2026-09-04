# TESTING_FRAMEWORK — how the agent tests what it creates

<!-- KAIF:PRAYER:BEGIN — ОДИН ИСТОЧНИК: PHILOSOPHY.md. Правится там, раскладывается `node tools/prayer.mjs --apply` -->
## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ

> **Слово владельца, 2026-08-24:** *«давай поднимем принципы из ФИЛОСОФИИ на уровень молитвы перед
> началом любой работы… с просьбой тебя молитву озвучить перед каждой работой»*.
> **Каденция уточнена владельцем 2026-08-28 (интервью 017, Q2 = B).**
>
> 🔴 **АГЕНТ: ПРОИЗНЕСИ ЕЁ В ЧАТЕ ЦЕЛИКОМ ОДИН РАЗ НА СЕССИЮ — при входе (`/resume`, вход в
> цикл), дословно, пунктов не пропуская. ПЕРЕД КАЖДОЙ СЛЕДУЮЩЕЙ ЗАДАЧЕЙ — ОДНА СТРОКА: ТРИ
> принципа из шестнадцати, самых важных для этой задачи, своим выбором.** Это не украшение:
> каждый пункт оплачен провалом; полный текст раз в сессию переносит его в решения дня, а выбор
> трёх под задачу — применение, а не декламация. Разбор каждого принципа — `PHILOSOPHY.md`.

1. **ПРОСТОТА ВЫШЕ ВСЕГО.** Если долго — значит я усложнил, а не задача трудна. Застрял — заново
   понять задачу, а не громоздить.
2. **ОККАМ.** Не умножаю сущностей. Из двух решений беру то, где меньше движущихся частей.
3. **ПАРЕТО.** Ищу те 20 %, что дают 80 % пользы. «Сделано и работает» лучше «идеально и поздно».
4. **КОД ПРЕЖДЕ КОГНИЦИИ.** Что может сделать скрипт — делает скрипт. Модели остаётся суждение.
5. **НАБЛЮДЕНИЕ ВМЕСТО ДОГАДКИ.** Не помню — смотрю. Прогон, замер, источник вместо «должно работать».
6. **ТРИ ДВЕРИ.** Пробел закрываю источником или вопросом владельцу. Выдумать — запрещено.
7. **ЛОШАДИ, А НЕ ЗЕБРЫ.** Сперва проверяю самое простое и частое объяснение.
8. **МЁРФИ.** Называю риски вслух и раскладываю по ярусам. Названный риск наполовину управляем.
9. **ЛУЧШИЕ ПРАКТИКИ.** Почти всё решено до меня. Ищу проверенный путь, прежде чем изобретать.
10. **DRY.** Один факт живёт в одном месте. Пару лучше УБРАТЬ, чем за ней следить.
11. **УЧУСЬ ОДИН РАЗ.** Сверяюсь с опытом до работы, дописываю урок после. Дважды в один тупик не хожу.
12. **ЭЙЗЕНХАУЭР.** Важное и срочное — сейчас; важное и не срочное — в план; прочее — вниз.
13. **БРИТВА ХЭНЛОНА.** Не злой умысел, а недосмотр. Отлаживаю состояние мира, а не мотивы.
14. **КВАДРАТ ДЕКАРТА.** На трудной развилке отвечаю на четыре вопроса, а не на два.
15. **ВТОРОЙ ПОРЯДОК.** Думаю на три-пять ходов вперёд, а не о выигрыше прямо сейчас.
16. **КАРМА.** Оставляю репозиторий лучше, чем взял. Не срезаю углы за счёт владельца и следующей сессии.

> ⚖️ **И ОДНА ГРАНИЦА, ЧТОБЫ МОЛИТВА НЕ СТАЛА ОРУЖИЕМ ПРОТИВ ВЛАДЕЛЬЦА:** Оккам и Парето действуют
> ВНУТРИ машинерии. На том, что владелец видит и слышит, агент не экономит — там судит его глаз, а
> не мой счёт сущностей.
<!-- KAIF:PRAYER:END -->

Raw generated content — code, a document, an analysis, anything — **must not be trusted**. It may *look*
logical and working and still be broken, or fail the owner's actual requirements (the idea, the plan, the
vision). An early defect that rides silently to production is the most expensive kind — it destroys
projects from the inside. Testing is a distinct, first-class part of ALL work, not a formality after it.
This document is the agent's testing canon; it applies to **every artifact in every sphere** — a function,
a dataset, a legal clause, a bridge design, a thought (what "verify" means in your sphere is defined by
the project's sphere library: its *Verification by observation* and *Minimum evidence set* sections).

## The seven principles of testing (the canon)

1. **Testing shows the presence of defects, not their absence.** A green suite never proves the product
   has no bugs — bugs ALWAYS exist; testing lowers the risk, never to zero.
2. **Exhaustive testing is impossible.** You cannot check every input/state combination — prioritize by
   risk and value instead of pretending completeness.
3. **Early testing saves the budget.** Verify at the requirements/plan stage; the later a defect is
   found, the more it costs (the waterfall skyscraper on an untested foundation).
4. **Defects cluster.** Most bugs live in a few narrow modules — where one was found, hunt for more
   (the fable-method twin check is this principle mechanized).
5. **The pesticide paradox.** The same tests stop finding new bugs — vary the tests, angles, and data.
6. **Testing is context-dependent.** Methods are chosen per project and sphere — a payment system, a
   research paper, and a landing page are not tested alike.
7. **The absence-of-errors fallacy.** A defect-free product that does not solve the user's task is
   worthless — always test against the OWNER'S requirements (`GOAL.md`, the idea, the plan), not only
   against the code's own consistency.

## The testing activities — the chain that makes "tested" mean something

The trust contract below says how much to TRUST a result; this section says how the testing WORK
is done. Field-paid reason for its existence (origin issue #21): with no obligation to design the
observation set, an agent ran ONE happy path, reported the feature as working, and the owner
produced five uncovered cases in about a minute. Testing a feature is a chain of activities, not
one observation — walk it in order, each step with its exit condition:

1. **Analyze the test basis.** Name the source of truth for the expected behaviour — a
   requirement, the owner's word, a spec, the canon map (`REQUIREMENTS_FRAMEWORK.md` shapes
   these). *Exit:* every claim under test quotes where its expectation comes from; an expectation
   that is missing or untestable goes back as a requirements defect (principle 3 — cheapest right
   here). Studying the requirements to derive the test basis IS a testing activity, not somebody
   else's chapter.
2. **Design the observation set by named techniques.** Derive the cases with the standard
   instruments: equivalence partitioning · boundary values · decision tables · state transitions ·
   pairwise · use-case walk · error guessing. *Exit:* a written case list whose DIMENSIONS are
   named — which partitions, boundaries and states are covered, and which are consciously not
   (principle 2: prioritize by risk, and SAY what was left out).
3. **Write the documentation before executing.** Test documentation lives in files, never in the
   session's head: a plan (what and why) · a suite / checklist (the ordered set) · cases (steps ·
   expected · status). Copy the shipped template into the project's test-doc home (default
   `testcases/`, created on first use; the sphere or the project may name another):
   `cp .kaif/_testcases-template.md testcases/TC_<feature>_<slug>.md` — an artifact class with no
   home and no shape does not get written.
4. **Execute with bookkeeping.** Every case ends in a status — `pass` · `fail` · `blocked` ·
   `skipped` — with the observation named (what ran, what was seen). *Exit:* no case without a
   status; coverage is the case list, never an impression.
5. **Run the control case before calling the feature working.** Turn the controlling flag off /
   remove the controlling parameter and observe the feature NOT work: a feature check that cannot
   fail proves nothing (gate 5 below, applied at feature level).
6. **File defects in the defined shape.** Steps to reproduce · expected vs actual ·
   severity/priority · environment · evidence — then hand off to `BUG_FIXING_FRAMEWORK.md`
   (one document per defect; skill `/report-bug`).

## Test-status markers — the trust contract

Every non-trivial artifact the agent generates carries an explicit, grep-friendly test status in its
comment / accompanying note. The marker strings are canonical English (like the `DONE` tag), regardless
of the project language:

- **`[NOT-TESTED]`** — freshly generated, raw. **Do not trust it.** The LLM "thought" it was right;
  that is not evidence.
- **`[TESTED: <date> · <how it was verified / what was observed>]`** — verified by observation, with
  the evidence named (a run, a render, a recomputation, a check against the source).

**The rules:**

1. **Creating raw content** (a non-trivial block/method/module/section) → write `[NOT-TESTED]` into its
   comment at birth. Commenting is already mandatory (`AGENT_GUIDE.md`); the marker is part of the
   initial comment.
2. **Meeting `[NOT-TESTED]`** (yours or inherited) → do not build on it blindly: plan its verification,
   verify **by observation** (fable-method Step 5: it ran, it rendered, it counted — never inferred from
   reading), then flip the marker to `[TESTED: …]` with the evidence named.
3. **Meeting `[TESTED: …]`** → you may trust it and need not re-test — but keep a grain of doubt
   (principle 1: bugs always exist). If evidence contradicts the marker, the marker is wrong: investigate.
4. **Testing found a defect** → file it (`/report-bug`, method: `BUG_FIXING_FRAMEWORK.md`), fix, re-test,
   and only then mark `[TESTED]`.
5. **A false `[TESTED]`** — the marker present with no verification actually performed — is a fraud;
   `/fable-judge` hunts it like any false completion claim. Never flip a marker without the observation.
6. **Carrier by artifact type:** code → the block/method comment; a document → the section's note; any
   other sphere → the nearest commentable carrier the sphere convention offers.
7. **A FEATURE marker requires a designed set.** `[TESTED]` on a feature is legal only alongside the
   written case set with its covered dimensions (the activities chain above); a single observation
   flips the marker of a single CASE, never of the feature. "It worked once on the happy path" is a
   case-level fact — a marker satisfied by one observation certifies that something was observed,
   while silently claiming the feature was tested: two different statements (origin issue #21).

Markers are the persistent memory of verification: fable-method's Step 5 verifies *in the moment*; the
marker preserves that fact **across sessions**, for future agents and posterity — who else will know the
foundation was load-tested?

## The work produces its own means of checking

"Raw deserves no trust" binds the PRODUCER, not only the checker: building something includes
building what checks it — a test suite, a check-list, test cases, a fixture, a guard. They are
planned WITH the work and land in the SAME step, never "later": verification postponed to a later
step is verification that never happens, and verification that lives only in a session's scratchpad
dies with the session. This is principle 3 (early testing) applied to production rather than to
inspection, and it is why the harness section below exists — the harness is what makes the checking
repeatable once it exists.

The contract in step form — walk it on every non-trivial piece of work:

1. **Name the check while planning the work.** The same task step that builds X names what will
   check X — a suite · a checklist · test cases · a fixture · a guard.
2. **Land both in the same step.** The check enters the repository together with the work — never
   "later", never only in the session's scratchpad.
3. **Prove the check on a broken version** before trusting its green (gate 5 below;
   `BUG_FIXING_FRAMEWORK.md` → Guards). A closed defect is additionally born with the guard for
   its CLASS — that rule lives in `BUG_FIXING_FRAMEWORK.md` ("a fix without a guard is a fix on
   credit") and is not restated here.

The triviality gate applies: a trivial change verified by its one obvious check needs no ceremony
beyond the usual comment and marker. What is never legal is finishing non-trivial work with nothing
that can re-check it.

## Green tests ≠ working — the observation gates

A green suite is one observation, not the verdict (principle 1): whole classes of defects are invisible
to every test and obvious to one minute of looking. Before "done" on anything that runs, renders, or
ships, walk the gates that apply:

1. **Live smoke with your eyes on the log.** Run the real process (not only the tests) and read its
   first working cycle in the log — startup, the key operation, no silent error spam.
2. **Self-sufficiency of the shipped artifact.** The image/bundle/package must start in isolation (a
   fresh container/directory) — a build that only works inside your working tree is not shipped.
3. **Domain invariants, before/after.** Before the work, write down the numbers that must not change
   (counts, sums, sizes); after, compare. Comparing two numbers is the one check any session performs
   perfectly — and its signal is among the highest there is.
4. **Countable quality proxies.** Where quality is visual or subjective, find what can be counted
   (animations per screen, panel-opacity checks, bundle growth): a zero on the counter is a stop-defect.
   A proxy never replaces the owner's eye — it catches the zeros *before* the owner has to.
5. **A check that has never failed proves nothing.** Every new guard/check is verified on a broken
   version first (see `BUG_FIXING_FRAMEWORK.md` → Guards); goldens for refactors are byte-exact —
   an empty diff is proof, "the numbers look the same" is not.
   **And the broken version is NAMED — together with its distance from the THREAT.** Reddening a
   guard against *a* broken version is necessary and not sufficient: four field guards in one
   evening were each green and mutation-proven — and each proven against the failure that was
   convenient to simulate (a process death on a digital twin instead of a machine freeze; a
   readback after a CLEAN close instead of a death without one; one warning instead of an
   accumulation; the first step instead of any step). The machine hung, and the fuse built for it
   recorded nothing (origin issue #35). A green mutation over a wrong-threat fixture does not
   withhold confidence — it ISSUES it, falsely. So every guard declares, next to itself, four
   greppable lines, and a guard is DONE only when the last one is no longer `NOT YET`:
   ```
   @guard <name>
   THREAT:         the real event it exists for
   PROVED-AGAINST: what the red run actually did
   GAP:            what the proof does NOT cover — or the word `none`, written after thinking
   ON-REAL-PATH:   where it was seen working on the path the owner actually runs — or `NOT YET`
   ```
   A recorder whose tape must outlive the event it explains declares the same way — `@forensic
   <name>` · `EXPLAINS:` the event · `DURABLE-AT:` when the evidence becomes durable — and `close`,
   `exit`, `trip-only` are rejected values: evidence durable only at a clean ending is not evidence.
   The optional tool module `kaif-guard-lint` (`.kaif/tools/`, `check` / `selftest`) reds on a block
   with a missing field or a rejected `DURABLE-AT`; it fires only on explicit `@guard` / `@forensic`
   markers and never guesses what a guard is.
6. **After a deploy, the gate is production itself, entered as a user.** Sign in by whatever door
   the product offers, walk the real screens, read the console — only then is "deployed" a fact.
   A smoke that only walks public surfaces proves the landing page is alive, not the product: if
   the product has authenticated state, an unauthenticated smoke is NOT evidence about the
   product. (Field-paid: three deploys in one night served an application that did not start at
   all, with every local instrument green — origin issue #18.)
6a. **«Is the engine mounted?» — the owner's name (2026-08-30) for gate 5's second half above.**
   A fuse built over two days, green suite, mutations reddening exactly their own blocks, recorded
   ZERO trips when the owner's machine actually hung — everything it was proved against was a
   SIMULATED process death on a test double, and the double cannot freeze its host. The owner:
   *«the engine passed its burn test, all tests green — you just forgot to mount it on the rocket,
   and the countdown has started»*. The obligation is the `@guard` block of gate 5 (with the DATE of
   the real-path observation — an observation without a date cannot be re-checked; an honest
   `NOT YET` is legal, a bare «works» is not). In this project it is a lint, not prose:
   `tools/guard-lint.mjs` (М1/М4, `plans/76`, the same fields, run by `npm run check` as «СТОРОЖ
   УГРОЗ»); the framework's `.kaif/tools/kaif-guard-lint.mjs` reads the same markers (KAIF 2.5,
   origin issue #35 — filed from this project as `bugs/KAIF/14`). Two texts of one rule are a pair;
   this one collapsed to the owner's word and the pointer (KAIF 2.5 → «a mechanized lesson
   collapses»).

7. **Artifact integrity before shipping.** "It built" and "it is one build" are different claims:
   the shipped bundle carries exactly ONE build identity, asserted mechanically before upload. An
   output directory that is not cleaned between builds ships a mixture of two builds — every
   individual file valid, the SET broken — and mixtures fail in ways no test sees.

Two placement rules, paid for by the same outage: gates 6–7 belong IN THE DEPLOY PATH, not in
prose — one deploy door that runs them itself and fails on any red step (where the agent system
has hooks, deny the raw deploy command; a rule that lives only in a document is a rule the
shipping session skips under pressure). And a post-deploy smoke must be able to FAIL on a dead
product: prove there was something to measure before painting green — a smoke that is greenest
when the product is emptiest is worse than no smoke.

## The taste class — when the observer must be human

A subjectively-perceptual acceptance criterion (a perception adjective: beautiful, natural,
pleasant, "feels right") is still verified by observation — but the OBSERVER is the human, by
necessity, not the agent. The agent's role is to PREPARE the observation: produce a mock-up on the
project's own material and hand over an artifact to perceive (`AGENT_GUIDE.md` → "The taste
class"; the homework doc with its two standing fields). The agent's own "sounds good to me" is not
a verification and never flips a marker; the owner's recorded verdict is.

## How this composes with the rest of KAIF

- **`REQUIREMENTS_FRAMEWORK.md`** — shapes what is REQUIRED before anything is made; this framework
  verifies what was MADE against it. Principle 3 (early testing) is executed at the requirements
  stage by that canon; bugs are what is born where the two meet (`BUG_FIXING_FRAMEWORK.md`). The
  boundary does not close the door on requirements analysis: deriving the test basis FROM the
  requirements is step 1 of the activities chain here.
- **fable-method** — Step 5 (verify by observation) is HOW a single check is performed; this framework
  says WHAT must carry a status and how trust propagates. The triviality gate still applies: a trivial
  change verified by its one obvious check needs no ceremony beyond its normal comment.
- **`/fable-judge`** — treats test-status markers as claims: a `[TESTED]` it cannot reproduce is REFUTED.
- **The guard-declaration block as a guard** — the optional tool module `kaif-guard-lint`
  (`.kaif/tools/`) runs gate 5's second half mechanically over explicit `@guard` / `@forensic` /
  `@fork` markers; advisory, `SKIPPED=3` when a tree declares nothing.
- **`BUG_FIXING_FRAMEWORK.md`** — where testing's findings go (one doc per defect; 3 attempts → research).
- **Spheres** (`.kaif/spheres/`) — define the sphere's evidence, verification-by-observation meaning, and
  fraud table; principle 6 lives there.
- **The harness** — invest in tooling that makes verification observable and deterministic
  (`AGENT_GUIDE.md` → Test harness); eyeballing is not testing.

*Grounding: the seven principles and the activities chain (test basis → design techniques →
documentation → execution → defect reporting) are the ISTQB canon (istqb.org; ru: testbase.ru) —
distilled here for an AI agent across all spheres. The activities section, the feature/case marker
rule and gates 6–7 were paid for in the field: origin issues #21 and #18.*
