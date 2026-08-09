# KAIF improvement request: document language is routed by directory, so owner-facing artifacts ship in English

kaif-fp: `AGENT_GUIDE.md#languages` vs `AGENT_GUIDE.md#planning-discipline` :: routing-by-list-contradicts-routing-by-purpose :: v2.2

**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/6 — filed 2026-08-09 on the
owner's word in chat («заводи в GH в проект KAIF»), under the owner's account.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.2 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (`ls bugs/KAIF/` → `01_placeholder_gate_scans_sphere_library.md`,
`02_adaptation_task_has_no_owner_voice_step.md` — both different surfaces) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 20` → 5 issues: #1, #2 CLOSED and
unrelated; #3 placeholder gate; #4 owner voice portrait; #5 the install field report — none about
document language) plus `--search "language audience localization"` → no results. No match found.

## Gap

`AGENT_GUIDE.md` routes document language by **file and directory**:

> Agent-internal documents (this guide, `PHILOSOPHY.md`, `BUG_FIXING_FRAMEWORK.md`, `STATUS.md`,
> `EXPERIENCE.md`, the maps, working notes in `plans/`/`bugs/`/`researches/`, the skills) are written
> and maintained in **English** … Owner-facing documents (`GOAL.md`, `KAIF_FRAMEWORK.md`, the
> directory READMEs) and every chat report to the owner are in **ru**.

Six lines earlier, the same file states the PURPOSE of an artifact that lives in `plans/`:

> the meta-plan is where **the owner sees the whole shape** once

Both sentences are in `AGENT_GUIDE.md`, three lines apart (317 and 323 in this deployment). They
disagree about the same document: the epic meta-plan is declared an owner-viewing artifact by one
and assigned to English by the other.

The list is also **narrower than the set the owner actually reads**, which produces two more
misroutes independent of the meta-plan:

| Document | What the rule says | What it actually is |
|---|---|---|
| `MASTER_PLAN.md` | absent from the owner-facing list | the roadmap the owner reads — and in this deployment it was written in **ru** anyway, so shipped practice already contradicts the shipped rule |
| `STATUS.md` | explicitly assigned **English** | the state summary the owner opens first; its own header calls it "the PRIMARY handoff" |
| `interviews/` | **not mentioned at all** | the owner-facing directory by definition — the canon's own "place of questions", where the owner answers inside the document |

## Reproduction

Deterministic, on any deployment with `"language"` set to a non-English value:

1. Deploy KAIF into a project whose `.kaif/kaif.json` records `"language": "ru"`.
2. Run `/plan-epic` on any heavy task.
3. Read the produced `plans/NN_EPIC_*.md`.

**Observed:** the meta-plan is in English, because `plans/` is on the English side of the list.
**Expected:** the meta-plan is in the owner's language, because the same guide says it exists for the
owner to see the whole shape.

The i18n step of the installer localizes a fixed set of owner docs (this deployment's field report
records "i18n 8 owner docs localized"), which is the same mechanism at install time: a **list**, not
a rule. Artifacts created later by skills are outside any list by construction.

## Why a list cannot carry this rule

The set of owner-facing documents is **open**: skills create new artifacts (epic meta-plans,
interviews, homework docs, reports) long after installation, and no list written at install time can
enumerate them. Routing by audience is a question the agent can answer about any future artifact —
*does the owner read this?* — while routing by directory can only answer about the files that existed
when the list was written.

The cost is not cosmetic. The owner of this deployment found it himself and said so plainly:

> «Я по-русски разговариваю вообще-то. И KAIF должен был быть установлен по русски с руководством
> тебе говорить со мной по русски.»

An owner who has to notice that his own planning document is in a foreign language has been handed
the framework's bookkeeping to do.

## Proposed change

Replace the list in `AGENT_GUIDE.md` → *Languages* with a routing **question** plus an audience
table, and state the two boundaries that stop it drifting:

1. **The rule:** *does the OWNER read this document?* → the owner's working language
   (`.kaif/kaif.json` → `language`). Read only by the agent → English.
2. **Audience table** naming, on the owner's side, at minimum: `GOAL.md` · `MASTER_PLAN.md` ·
   `STATUS.md` · `KAIF_FRAMEWORK.md` · epic meta-plans (`plans/NN_EPIC_*.md`) · everything in
   `interviews/` · directory READMEs · `README.md` · release notes · every chat report.
3. **Boundary A — promotion rewrites.** A document that starts being read by the owner changes
   language; the audience decides, and the audience changed.
4. **Boundary B — recon and executor detail stay English** (`researches/`, operational plan steps).
   The owner meets their conclusions through the meta-plan and the interviews, which quote the
   material in his language — which is exactly what the canon's self-sufficient-question rule
   already demands.

Worth considering upstream, though this project does not need it: `/plan-epic` could state the
meta-plan's language at the point of writing, since a rule at the decision point is what weak
sessions actually follow — the same reasoning the canon already applies to forced artifacts.

## Local remediation

`AGENT_GUIDE.md` → *"Languages — routed by AUDIENCE, never by directory"* now carries the rule, the
audience table and both boundaries as described above. Consequent rewrites in this project:
`plans/01_EPIC_kago_orchestrator.md` and `STATUS.md` were rewritten in **ru**.

**Divergence to reconcile at the next `/kaif-update`:** this project's *Languages* section is a
rewrite, not an edit — an upstream fix landing in the same section will conflict textually. The
intent is identical, so the merge is a choice of wording, not of behaviour.

## Field evidence

- Project KAGO, KAIF 2.2, deployed 2026-08-09, `language: ru`.
- The misroute appeared on the **first** use of `/plan-epic` in the deployment, within hours of
  install — not after months of drift.
- The owner's decision on the correct split, given in chat the same evening: owner-read documents in
  Russian; purely executor material (operational plan steps, `EXPERIENCE.md`) stays English.
