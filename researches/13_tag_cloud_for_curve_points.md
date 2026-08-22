# Research 13 — a tag cloud on the tuning-curve row: what the single `status` field cannot carry

> **Created:** 2026-08-22 20:2x +03:00 (agent, on the owner's order in chat — *«запланируй
> операционное планирование по этой фиче — характеристика точкек VF тюнинг кривой облаком тегов»*)
> **Parent:** the owner's chat of 2026-08-22 20:1x–20:3x · `plans/13_EPIC_edge_finder_full_range.md`
> (the epic whose document this changes) · R14 in `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`
> **Status:** 🔬 recon complete 2026-08-22 20:3x — rung 1 of the planning ladder; no code
> **Outbound:** the tag vocabulary is CANON and belongs to the owner → an interview · the findings
> below → the epic meta-plan's evidence base

---

## 0. The owner's ask, verbatim

Four messages, 2026-08-22, in the order he sent them:

> *«если точка сильно отличается от соседей, то она под подозрением на то, чтобы её перемерить,
> верно?»*
>
> *«есть идея, точкам не просто одно поле статус завести, а поле статуса в виде массива, или словаря
> тегов. И можно внутрь сколько хочешь много тегов засовывать, и какждый тег — это характеристика
> точки. И можем несколько характеристик в разное время ей давать. Может такой подход лучше и нам
> поможет?»*
>
> *«мнесто якобы одного свойства строкой, облаго тегов, описывающих судьбу, историю, свойства точки»*
>
> *«чтобы код в будущем понимал, что за точка, и как с ней быть по её тегам»*

And, after the agent named the migration cost, the sequencing decision that reshapes the epic:

> *«ну и по идее, нет смысла запускать прогон, пока мы со старой логикой статуса, а не с новой
> логикой облака тегов. Нужно делать MVP облага тегов, текущий статус в него запихивать, и минимально
> может расширить — только после этого есть смысл делать прогон и по ходу дела развивать и улучшать
> фичу тегов свойст точек»*

Three things are decided by those words and are NOT open questions below: the model is a tag cloud
(not the agent's proposed status-plus-tags hybrid); the MVP carries today's status into tags and
extends only minimally; the live sweep waits for the MVP.

## 1. Local recon — how the row stands today

### 1.1 The format

`curve-store.mjs` is the document's only author (R14a). A row is six fields, and `ROW_KEYS` is an
**exact-match list** — an unknown field is a refusal, not a warning:

```
ROW_KEYS = ['mhz', 'voltageMv', 'stockVoltageMv', 'status', 'provenBy', 'editedAt']
```

`status` comes from `CURVE_STATUS`, a **frozen, closed vocabulary** of seven values: `stock` ·
`probing` · `short-burn-proved` · `edge-found` · `long-burn-proved` · `lever-limited` ·
`depth-capped`. An unknown status is refused by name. The production document
(`curves/measured.json`) holds 389 rows: 327 `stock`, 60 `lever-limited`, 2 `edge-found`.

### 1.2 THE DECISIVE LOCAL EVIDENCE: the project has already split this field once, and paid for it

`DEPTH_CAPPED` was carved out of `LEVER_LIMITED` on 2026-08-17, and the reason is recorded in the
vocabulary's own comment. Quoted, because it is the strongest argument for the owner's idea and it
was written before he had it:

> *«on 2026-08-17 the owner read a finished run and asked what «предел рычага» meant, because **54 of
> the 54 rows closed that night carried it and NOT ONE of them had hit the offset range** — every
> single one stopped at his own −100 mV. The `provenBy` witness said so literally … and the STATUS
> beside it said the opposite. A reader who trusts the status concludes the card cannot go lower; the
> truth is that we chose not to look.»*
>
> *«It had been noticed the day before and left alone because «the vocabulary is CLOSED». That was the
> wrong reading of a good rule: the vocabulary is closed against ACCIDENTAL values … not against
> correcting a statement that is false. **A closed vocabulary containing a lie is worse than an open
> one, because the closure is what makes readers trust it.**»*

So the one-word field has already been observed lying to the owner, on 54 rows of one night, and the
remedy was to add a word. That remedy scales badly: every new distinction costs a new value, and the
values multiply combinatorially the moment two distinctions are independent.

### 1.3 What is independent TODAY, and where each fact currently lives

Enumerated by reading the code, not by recall:

| Fact about a row | Exclusive or cumulative | Where it lives now |
|---|---|---|
| what stopped the descent — edge / our depth cap / lever wall / hang floor | **exclusive**, one value | `status` — legitimately |
| how deeply it is proved — 10 s burn · 1 min burn · the owner's own game | **cumulative** | `status`, and only the last one wins: `long-burn-proved` OVERWRITES `edge-found` |
| provenance — measured here · inherited down a rung · raised by the monotonicity ratchet | **cumulative** | PROSE inside `provenBy`, machine-unreadable |
| which shape / holder / burn produced it | cumulative | prose in `provenBy` |
| suspicion — burned below its filed frequency (`bugs/28`) · outlier against neighbours | cumulative | **nowhere at all** |
| applicability — R17's «consistent but not applicable» | derived | computed, never recorded |

Two of those six are already inexpressible, and one (`provenBy`) is a prose field that the code
cannot branch on — which is exactly the owner's complaint: *«чтобы код в будущем понимал, что за
точка, и как с ней быть по её тегам»*.

**The overwrite is the sharpest of these.** `closePoint` sets one status, so a frequency that found
its edge and THEN held the one-minute burn cannot say both. The owner's convergence loop
(`AGENT_GUIDE.md` → «THE SHIPPED POINT…») is built on accumulating exactly that kind of evidence
over time, and the document has no place to accumulate it.

### 1.4 Consumers — the blast radius, counted rather than estimated

Read via `grep '\.status'` across `automation-engine/`, `tools/`, `benches/`, discarding unrelated
`status` fields (process exit codes, HTTP, NvAPI cooler status):

| Consumer | What it does with `status` | Note |
|---|---|---|
| `curve-store.validate` | refuses an unknown value; `ROW_KEYS` exact-match | the gate the migration must pass |
| `curve-store` coverage/monotonicity/summary (lines 191, 354, 477, 541, 748) | five separate places branch on `STOCK`/`PROBING`/the closed set | the densest cluster |
| `curve-store.closePoint` | writes the status, appends the ratchet's prose to `provenBy` | the only author |
| `engine.seedFor` | `PROVEN = {short-burn-proved, edge-found, long-burn-proved}` — a SECOND, hand-written subset of the vocabulary | ⚠️ a truth↔mirror pair: a new proven status must be added here too, and nothing enforces it |
| `engine` selftest blocks (≈8 sites) | assert statuses by name | migrate with the code |
| the dashboard / bench fixtures | render and construct rows | must gain the field |

**The `seedFor` subset is the pair to watch, and it is the same shape `bugs/24` cost five days:** a
vocabulary that lives in one place and is subsetted by hand in another. A tag model can COLLAPSE it
(ask for a tag, not for membership of a hand-copied list) rather than merely move it.

### 1.5 The lesson this migration must not re-learn

`bugs/24` — the `curveCapMhz` migration (`2d7d266`) rewrote the profile FILES and missed the three
places a profile is built in CODE (`ladder-descent.candidateProfile`, the applier's fixture,
`virtual-pl250`). Three suites stood red for five days, and the defect was a latent blocker of the
live sweep. **The generalisation for this epic: the FIRST step of the migration is a written
inventory of every place a curve row is CONSTRUCTED, not only of every file that stores one.**

## 2. Industry sweep — what is known about this problem class

### 2.1 Provenance modelling says a single field is structurally insufficient

Scientific-measurement provenance is the mature field for exactly our artifact: a record whose value
is only trustworthy together with the history of how it was obtained. The literature is consistent
that provenance is *multi-dimensional* — the sequence of activities, the instruments, the people, the
samples — and that it must be captured as machine-actionable metadata bound to the measurement at the
point of measurement, not reconstructed later. A single categorical field cannot express a chain.
([Ten Simple Rules for Experiments' Provenance, PLOS Comp Biol](https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1004384) ·
[A framework for traceable storage and curation of measurement data](https://www.sciencedirect.com/science/article/pii/S2665917421001641) ·
[Towards dimensions and granularity in a unified workflow and data provenance framework](https://arxiv.org/html/2504.11278v1) ·
[Provenance tracking — best practices in neurophysiology](https://rrcns.readthedocs.io/en/latest/provenance_tracking.html))

Direct implication for us: our `provenBy` prose field IS an attempt at provenance, made unreadable by
being prose. The tag cloud is the machine-actionable form of what we already keep.

### 2.2 Domain modelling says the single-enum status IS a named anti-pattern

The failure mode is documented and matches ours line for line: an enum starts as a clean state label,
then accumulates orthogonal concerns, and conditionals branching on its members spread through the
codebase. The recommended remedy where a class has several *status dimensions* is explicit,
separately-named properties rather than one overloaded field — and flags alone are warned against
precisely because they cannot express **mutually-exclusive groups**.
([The Distributed Enum Anti-Pattern](https://medium.com/thousandeyes-engineering/the-distributed-enum-anti-pattern-3ebb23cbc5d8) ·
[Explicit State Modeling](https://medium.com/@martinezdelariva/explicit-state-modeling-f6e534c33508) ·
[State Pattern vs. Enums in Modern PHP](https://dev.to/codecraft_diary_3d13677fb/state-pattern-vs-enums-in-modern-php-2oeg) ·
[SQL anti-pattern: never use boolean flags](https://dev.to/davidrjenni/sql-anti-pattern-never-use-boolean-flags-396d))

⚠️ **The warning is the useful half, and it is the one finding that constrains the owner's design:**
a flat bag of tags loses the ability to say «exactly one of these». Our «what stopped the descent» is
exclusive by nature — `edge-found` and `lever-limited` must never coexist on one row. **This does not
argue against the tag cloud; it argues for tags that carry a CLASS**, with a class declared exclusive
or cumulative. That keeps the owner's model whole and buys back the property the anti-pattern
literature says flags throw away.

### 2.3 Free-form tags are the failure mode, and controlled vocabulary is the cure

Library and information science has run this experiment at scale. Free tagging (folksonomy) is cheap
and expressive; its measured costs are subjectivity, unknown relations between tags, and degraded
retrieval — the tags stop meaning one thing. The literature's own summary of folksonomy's advantage
is telling: not that it beats a controlled vocabulary, but that it beats *nothing*, because a
controlled vocabulary is expensive to build and enforce. The mature answer is hybrid — a controlled
core with faceted structure.
([Folksonomies: (Un)Controlled Vocabulary?](https://www.researchgate.net/publication/28807454_Folksonomies_UnControlled_Vocabulary) ·
[Webology editorial: Folksonomies — why do we need controlled vocabulary?](https://www.webology.org/2007/v4n2/editorial12.html) ·
[Ontology of Folksonomy, Tom Gruber](https://tomgruber.org/writing/ontology-of-folksonomy.htm) ·
[The Structure and Form of Folksonomy Tags](https://ital.corejournals.org/index.php/ital/article/download/3272/2885/5590))

For us the cost side of that trade is already paid: KAGO ALREADY has a controlled vocabulary and a
refusal-by-name for anything outside it. **So the expensive half of the hybrid exists; the epic
extends it rather than builds it.** A tag vocabulary that stayed open would throw away the one
mechanism that currently stops a session inventing a status.

**Anti-pattern to record explicitly:** tags as free strings. Every session invents its own word, the
document becomes unreadable within weeks, and — specific to us — the code cannot branch on a
vocabulary nobody can enumerate, which is the very thing the owner asked for.

## 3. Findings

1. **The owner's instinct is confirmed by the project's own history, not just by theory.** The single
   field has already been observed lying to him on 54 rows in one night (§1.2), and splitting the word
   was a remedy that does not scale.
2. **Two facts the project needs are inexpressible today** — accumulated proof depth, and suspicion —
   and a third (provenance) is stored as prose the code cannot read (§1.3).
3. **The overwrite is a data-loss bug hiding in the format:** `long-burn-proved` erases `edge-found`,
   so a row cannot say both, while the owner's convergence loop is built on accumulating exactly that.
4. **The industry's single caution is about exclusivity, not about tags** (§2.2), and it is satisfied
   by giving tags a class rather than by abandoning the cloud.
5. **The vocabulary must stay closed** (§2.3). This is the one place where the epic must resist the
   most attractive reading of «сколько хочешь много тегов».
6. **The migration's real risk is the in-code builders, not the files** (§1.5), and `seedFor`'s
   hand-copied subset (§1.4) is a pair the tag model can remove outright.
7. **Behaviour-neutrality is achievable and provable.** The project already has the precedent: R14c
   derives `offsetMhz` on load rather than storing it. Deriving the legacy `status` FROM the tags at
   load time is the same shape — one stored truth, a computed view — so consumers can migrate one at a
   time and a byte-exact golden of the derived documents proves nothing moved.

## 4. Implications for the epic

- **Phase 1 is a LOSSLESS, behaviour-neutral migration** — tags carry exactly what status carries,
  the derived view keeps every consumer working, and the proof is a byte-exact diff of the document
  and of the dry run's output before and after. Nothing new is decided in phase 1.
- **The inventory of in-code row builders is step 1 of phase 1**, written down before the first edit.
- **The tag vocabulary is CANON and belongs to the owner** (`AGENT_GUIDE.md` → write-gate: new
  entities enter through the owner's yes). It goes to him as an interview with the proposed classes
  quoted in full, not as a reference to this file.
- **The live sweep moves behind phase 1** by his decision (§0), and that ordering is now cheap to
  justify: 13 frequencies measured tonight would otherwise have to be migrated with the format.

## 5. Open forks for the owner

Carried into `interviews/` rather than decided here — the vocabulary is his.

1. **Do tags carry a class** (exclusive / cumulative), or is the cloud flat? The agent recommends
   classes; §2.2 is the evidence, and the risk of flat is two contradictory terminal reasons on one row.
2. **What goes into the MVP vocabulary** beyond re-expressing today's seven statuses — the candidates
   are `origin:*` (measured / inherited / ratcheted, today prose) and `suspect:*` (his outlier idea,
   `bugs/28`'s class).
3. **Does the stored row keep `status` at all**, or is the legacy field derived-on-load only and
   dropped from `ROW_KEYS` at the end of phase 1?

## 6. Decisions made without the owner

None yet — this document only reads and reports. Every design call above is carried to §5 as a fork
or to the meta-plan as a proposal, and none is implemented.
