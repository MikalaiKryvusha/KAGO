# REQUIREMENTS_FRAMEWORK — how the agent writes and checks requirements

A requirement written badly is a defect shipped before the first line of code: every plan, test, and
review downstream inherits its ambiguity. When the agent writes requirements, acceptance criteria, or
goal statements for itself or for the owner — in a plan, a bug fix's "done when", an idea, an epic —
they are written by THIS canon. The one-line boundary with its sibling: **`TESTING_FRAMEWORK.md`
verifies what was MADE; this framework shapes what is REQUIRED** — the earliest testing there is
(testing principle 3: verify at the requirements stage, where defects are cheapest).
**`BUG_FIXING_FRAMEWORK.md`** closes the chain: bugs are what is born when TESTING's checks run
against what REQUIREMENTS demanded.

**Goal vector first.** Every target document (plan, epic, bug, idea) OPENS with its goal vector —
*what pain we solve and where we want to be* — and its acceptance criteria — *how we observe that we
arrived*. Plans without them are speculation with no purpose; with them, plans become checkable.
Goal types worth naming explicitly: **Achieve** (reach a new state), **Maintain** (keep an invariant
holding), **Avoid** (keep a bad state out). Vectors and criteria are NOT final truths — they may be
modified, added, or removed as the work teaches; changing them is an edit, not a failure.

## The ten quality criteria (the canon)

Each criterion: essence, a ❌/✅ pair, and its anchor in ISO/IEC/IEEE 29148 (IEEE 830's heir).

1. **Atomic (singular).** One requirement — one isolated thought; if it splits into independent
   sub-requirements, split it. *(29148: Singular)*
   ❌ The system shall let a user register and send a confirmation email.
   ✅ 1.1 The system shall register a user. · 1.2 The system shall send a registration-confirmation email.
2. **Complete.** The sentence carries everything needed to implement it — no gaps, no "and so on".
   *(29148: Complete)*
   ❌ The registration form shall contain name, email, etc.
   ✅ The registration form shall contain the mandatory fields "Name", "Email", "Phone number".
3. **Unambiguous.** Exactly one reading exists; every reader understands the same thing. *(29148: Unambiguous)*
   ❌ The system shall be fast.
   ✅ Catalog search shall respond within 200 ms at up to 500 RPS.
4. **Consistent.** It contradicts no other requirement or adjacent document. *(29148 set characteristic:
   Consistent)*
   ❌ §1 "Login is by password." · §3 "Login is possible only by SMS code."
   ✅ Login is by password; an SMS code is additionally required on a new device.
5. **Verifiable.** A defined way exists to check the implementation succeeded; the criterion is
   measurable. *(29148: Verifiable — the heart of the whole canon)*
   ❌ The interface shall be convenient and intuitive.
   ✅ A purchase completes in at most 3 clicks from the cart page.
6. **Feasible.** Technically achievable within the budget, deadlines, and stack. *(29148: Feasible)*
   ❌ 10,000,000 RPS on one virtual server.
   ✅ Up to 1,000 RPS with horizontal scaling.
7. **Necessary.** It carries real value for the owner or user; deleting it would lose a needed
   property. *(29148: Necessary)*
   ❌ A pink admin theme nobody asked for.
   ✅ The theme request is declined: no business value in the primary scenario.
8. **Prioritized.** Every requirement carries an importance level (e.g. MoSCoW) — and the levels
   differ; "all 150 are critical" is an unprioritized list. *(29148: a requirement attribute;
   IEEE 830: ranked for importance)*
9. **Traceable.** The source is known (business goal, law, owner's word) and the links to code and
   test cases exist. *(29148: the trace attribute; IEEE 830: traceable)*
   ✅ REQ-05 (source: goal BC-02; linked: test TC-12, task JIRA-402).
10. **Modifiable.** The document's structure lets one requirement change without breaking the others —
    one fact lives in one place, referenced elsewhere (DRY). *(IEEE 830: modifiable, a set property)*

What the 29148 anchor adds beyond these ten: per-requirement **Appropriate** (stated at the right
level), **Correct** (an accurate need), **Conforming** (follows the set's conventions); per-set
**Comprehensible** and **Able to be validated**. The ten above are the working canon; the standard is
the anchor to consult when a case falls between them.

## The sentence discipline (NASA Appendix C, distilled)

- **One modal, used honestly:** *shall* = binding requirement · *should* = preference/goal · *will* =
  statement of fact about the surroundings. Normative keywords per RFC 2119/8174: MUST/SHALL, SHOULD,
  MAY are normative **only in UPPERCASE** — lowercase prose stays prose.
- **Active voice, actor named:** "The system shall …", never "… shall be provided" (by whom?).
- **One thought per sentence** (criterion 1 in grammar form); conditions explicit, not implied.
- **EARS patterns** — the de-facto notation for agent-written requirements; pick the shape that fits:
  - *Ubiquitous:* The <system> shall <response>.
  - *Event-driven:* **WHEN** <trigger>, the <system> shall <response>.
  - *State-driven:* **WHILE** <state>, the <system> shall <response>.
  - *Unwanted behavior:* **IF** <condition>, **THEN** the <system> shall <response>.
  - *Optional feature:* **WHERE** <feature is present>, the <system> shall <response>.
  A non-English project mirrors the keywords in its working language, keeping them UPPERCASE next to
  the original — the pattern, not the English, is the notation.

## The stop-word dictionary (unverifiable words)

Words that make a requirement unverifiable by construction (NASA's black list + requirements smells).
The dictionary is a **grep-lintable guard**: a hit means *rewrite measurably or justify explicitly in
place* — it consults, it does not forbid writing.

| Class | Words |
|---|---|
| Perception adjectives | user-friendly · easy · convenient · intuitive · seamless · flexible · robust · beautiful |
| Unbounded qualifiers | fast · quickly · efficient · optimal · adequate · sufficient · significant · minimal · best |
| Escape clauses | as appropriate · as applicable · if possible · as needed · where practicable |
| Open-ended lists | etc. · and so on · including but not limited to · and/or |
| Vague verbs | support · handle · process · manage · improve · maximize · minimize (no measure) |
| Placeholders | TBD · TBS · TBR |

The shipped linter (`kaif-requirements-lint`, below) carries this dictionary in **English and Russian**;
a project in another working language mirrors the classes into its language the same way (the class,
not the wording, is the dictionary). A stop word inside a *quotation, a ❌ example, or a named
justification* is legal — the guard hunts unverifiable REQUIREMENTS, not vocabulary.

## The fit criterion (acceptance-criteria formula)

Every requirement and every goal-vector line carries a **fit criterion** — the measurable test of
compliance a future session can run without asking. For numeric criteria use the Planguage triad:
**Scale** (the unit measured) · **Meter** (how/with what it is measured) · **Target** (the number to
reach). "Search is fast" → Scale: ms per query at 500 RPS · Meter: load-test run L-7 · Target: ≤ 200 ms.
A criterion nobody can measure is a wish; a criterion with Scale/Meter/Target is a check the agent can
execute and cite (verification then follows `TESTING_FRAMEWORK.md` — by observation, never inferred).

## Boundaries — what this framework is NOT

- **Not a Definition-of-Ready gate.** The criteria work as a LINTER and a judge's rubric over what is
  written — never a turnstile that forbids starting work until requirements are "ready" (that is the
  mini-waterfall anti-pattern). Draft freely; lint what you drafted; perfect what survives.
- **Not BDUF.** No full specification up front — requirements are written for the work at hand
  (a plan's goal vector, a bug's "done when"), and grow with the work.
- **Not Gherkin-everywhere.** EARS shapes the *requirement sentence*; scenario syntax is a per-project
  choice, not a canon obligation.
- **Not a second testing canon.** TESTING verifies what was made; REQUIREMENTS shapes what is
  required — one line, one boundary, no overlap.

## How this composes with the rest of KAIF

- **Target-document templates** (plans, epics, bugs, ideas — their skills and directory READMEs) open
  with "Goal vector + acceptance criteria"; this document defines HOW those lines are written well.
- **The stop-word dictionary as a guard** — the optional tool module `kaif-requirements-lint`
  (`.kaif/tools/`) runs the dictionary as a grep step over target documents; advisory, with an
  explicit-justification escape.
- **`/fable-judge`** — treats acceptance criteria as claims to re-run; an unverifiable criterion is
  judged like an unverifiable "done".
- **`TESTING_FRAMEWORK.md`** — receives every fit criterion at verification time; principle 3 (early
  testing) is the reason this framework exists.
- **`PHILOSOPHY.md`** — the three-doors rule: a gap in a requirement is filled from a source or asked
  as a question, never invented plausibly.

*Grounding: IEEE 830 / ISO/IEC/IEEE 29148:2018 (the ten-criteria distillation is the KAIF canon),
NASA SE Handbook Appendix C, EARS (Mavin), Volere fit criterion, Gilb's Planguage, RFC 2119/8174,
requirements smells (Femmer et al.) — distilled for an AI agent across all spheres.*
