# Research 37 — how a working artifact is promoted into a shipped one through a gate

> **Created:** 2026-09-09 (session 97) · **Parent:** `bugs/134` — the owner's ruling that a battle
> mode must stand on a SNAPSHOT and that the promotion must pass a judge and a validator ·
> **Status:** written; feeds the meta-plan of the promotion gate and the interview on what the
> validator judges · **Outbound:** the criteria list goes to the owner as a question (the word
> «adequacy» is his and is a stop-word by `REQUIREMENTS_FRAMEWORK.md`); the design decisions go to
> the plan.

---

## 0. Why this document exists

The owner ruled (2026-09-09, verbatim in `GOAL.md` → «📸 БОЕВОЙ РЕЖИМ СТОИТ НА СНИМКЕ»):

> *«должны указывать на снимок, и передача рабочей копии в снимок - должна проходить суд и
> валидатор. который проверяет адекватность и корректность передаваемой кривой»*

Two things are needed before any code: **what the industry already knows about promoting a working
artifact into a shipped one**, and **what this project has already decided about it and forgotten**.
The second turned out to be the larger half.

---

## 1. LOCAL RECON — the project already assigned this check, in August, and never built it

This is the finding that changes the shape of the work: the owner's order is **not a new contour**.
It is a check the project specified for itself on 2026-08-16 and left unbuilt.

### 1.1 The internal map, rule R17 (2026-08-16)

> *«The half that was removed is not dropped, it is REASSIGNED: a partially swept document is
> CONSISTENT but not APPLICABLE — the card serves a clock with the lowest entry that reaches it, so a
> promise made for a frequency nobody has measured cannot be enforced once a HIGHER frequency has
> been made cheaper. That check belongs to the phase that APPLIES documents (epic 02 phase 5), not to
> the one that writes them.»*

### 1.2 The epic's own phase-5 gate (`plans/13` §4), in red

> *«🔴 ПРИМЕНИМОСТЬ НЕДОМЕРЕННОГО ДОКУМЕНТА ПРОВЕРЯЕТСЯ ЗДЕСЬ … Документ с непокрытыми частотами
> НЕПРОТИВОРЕЧИВ (и потому сохраняется), но применять его нельзя — сторож обязан отказывать в
> применении, а не в записи»*

### 1.3 The lesson that produced both (EXP-0057)

> *«a guard written for a FINISHED artifact will fire on the artifact's INTERMEDIATE states … narrow
> the guard to what it can honestly assert, and write the dropped half down as a DIFFERENT check with
> an owner … Dropping it silently would have been the real defect.»*

**What the owner's ruling adds to the August decision, and it is an improvement:** August put the
check at APPLY time (the click). The owner puts it at PROMOTION time. Promotion is strictly better —
a refusal at the click leaves him with no working mode, a refusal at promotion leaves the previous
snapshot serving. That is the champion/challenger property of §2.2 below, arrived at independently.

### 1.4 The tension the check must resolve, and it is REAL — two of our own rules disagree

| rule | says |
|---|---|
| **R16(b)** / E2-AC3 | a voltage PROVEN at a higher frequency is **not optimistic** at a lower one — Vmin does not decrease with frequency, so downward inheritance is SAFE |
| **R17** | a promise made for an unmeasured frequency **cannot be enforced** once a higher frequency was made cheaper |

They are not in contradiction once the subject is named: R16 is about **hardware safety** (the
inherited voltage is conservative), R17 is about **the document's descriptive honesty** (the row says
`F_low → V_stock` while the card will actually serve `F_low` at the cheaper entry). So the
applicability check is about **the artifact telling the truth about itself**, not about danger.

🔴 **This distinction must reach the owner**, because it decides how harsh the validator is: today
**295 of 389 rows are unmeasured** and the mode is shipped and playing. A validator built on a naive
reading of R17 would refuse the mode he is using right now.

### 1.5 What must NOT be snapshotted — EXP-0082

> *«a value read once and used for the whole run is a SNAPSHOT, and a snapshot of something that
> moves is a lie that grows with the run's length.»*

The boundary this draws for the design: **snapshot the DOCUMENT (an artifact with one author, which
moves only when we move it) — never the card's live V/F table** (which slides with temperature,
≈ −1.7 MHz/°C, R14b). `bugs/133` is what the second one costs. The snapshot freezes what we PROMISE,
never what the card IS.

---

## 2. INDUSTRY RECON — who solved «promote a working artifact into production»

Consumer undervolting tools were checked first and are **not** the authority here: MSI Afterburner,
ASUS GPU Tweak III and their kin save a profile and apply it, with no promotion gate at all — the
curve editor's «align points down» is an editing convenience, not a validator. The authority lives in
two other domains that promote a working artifact into a shipped one for a living.

### 2.1 Model registries (MLOps) — the closest structural match

| their concept | our equivalent |
|---|---|
| the model in the dev workspace | `curves/measured.json`, the working document |
| an **immutable, versioned** artifact in the registry | the battle snapshot |
| **policy-as-code gates** on promotion | the validator |
| **regression against the incumbent** — the challenger must beat or match the deployed baseline on a golden set | the new snapshot against the currently shipped one |
| the **signature/schema** validated and stored with the artifact | our stamp (driver · VBIOS) and the row schema |
| **lineage pointers** — which run produced this | which sweep closed which row |

### 2.2 The champion/challenger property — the strongest argument for the owner's ruling

> *«The champion alias should remain on the current production model until all gates pass; the
> challenger stays in Staging otherwise.»*

**This is exactly what would have saved the owner's evening on 2026-09-09.** With a snapshot in
place, the sweeps of sessions 88–95 would have gone into the working document, failed (or not even
been offered) promotion, and the shortcut would have kept applying the last promoted curve. The
defect he met — a shipped mode that stopped working because upstream work changed under it — is
structurally impossible once promotion exists.

⚠️ **Honest boundary, and it is measured:** this argument is about the CLASS. It would not have saved
*this particular* evening — `bugs/133`'s refusal is manufactured at apply time by the basis↔live
table difference, and the 31.08 curve breaks the order too (measured). Promotion prevents *«the
battle mode changes under the owner's feet»*; it does not prevent *«the vector does not fit the cold
card»*.

### 2.3 Safety-critical calibration release — a table of numbers that drives hardware

Three transferable rules, and the third is the important one:

1. **Range and definedness first.** *«validation involves verifying that certain parameters are
   within allowed ranges and that undefined values have not entered the calibration»* — the cheapest
   checks run first, before anything clever.
2. **Two independent sources.** *«use at least two values received from different sources»* — our own
   truth↔mirror discipline, arrived at from the other side.
3. **🔴 THE GATE IS ASYMMETRIC.** *«modifications to calibration testing that reject only overconfident
   predictions, allowing for pessimistic or cautious predictions in safety-critical settings»* — a
   candidate that claims LESS than proven passes; one that claims MORE is refused.

Point 3 independently corroborates the direction chosen in `bugs/133` hours earlier (the order clamp
lowers, never raises) and it is the single most useful sentence found in this sweep: **it converts
«adequacy» from a taste word into a direction.**

---

## 3. What this recon yields for the validator — CANDIDATES, not decisions

Ordered cheapest-first, each with its authority. **None of these is adopted here**: the criteria are
the owner's acceptance criteria, and `REQUIREMENTS_FRAMEWORK.md` forbids the agent from inventing
what «adequacy» means.

| # | candidate check | authority | cost |
|---|---|---|---|
| 1 | schema and stamp: rows well-formed, driver/VBIOS match the card | §2.1 signature · §2.3.1 · R6 | trivial, exists |
| 2 | the document passes its own validator (`validateCurveDoc`, `firstInversion`) | ours, exists | trivial, exists |
| 3 | the resulting OFFER holds order and envelope (R12 · R13) against the card | ours, exists — **moved from the last edge to the gate** | small, exists |
| 4 | **asymmetry**: no row promises deeper than the working document proved | §2.3.3 | small |
| 5 | **regression against the incumbent**: diff against the shipped snapshot, every row that got SHALLOWER named | §2.1 | small |
| 6 | **coverage**: how many frequencies closed by edge, how many still stock | R17 · §1.4 | small |
| 7 | **applicability**: the R17 question — what the card will actually serve for unmeasured frequencies | R17 · §1.4 | 🔴 needs the owner's word |
| 8 | lineage: which run closed which row | §2.1 | medium |

**Checks 1–3 are the Occam core: they already exist and only move earlier.** Checks 4–6 are small
additions of the same shape. Check 7 is the one that cannot be decided without him, and §1.4 is why.

---

## 4. The question that must go to the owner, and what it must carry

By the self-sufficiency rule the question carries its subject inside it, not a reference. It must
show: the table of §3 · the number **295 of 389 rows unmeasured** · the plain statement that a strict
R17 reading refuses the mode he is playing on right now · and the three candidate severities
(refuse · promote with a named coverage warning · promote silently). That is an `/interview`, and it
is written when the meta-plan exists — not before, because the plan is what prices each option.

---

## 5. Sources

- [MLflow Model Registry Workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
- [ML Governance: The Champion-Challenger Pattern for Model Deployment](https://stacksimplify.com/blog/ml-governance-model-registry/)
- [CI/CD for AI Models: Shipping Intelligence to Production](https://bidekani.com/blog/ai-model-cicd)
- [Model registry & promotion — MLOps](https://datarekha.com/mlops/model-registry/)
- [Security Hardening with Plausibility Checks for Automotive ECUs](https://personales.upv.es/thinkmind/dl/conferences/vehicular/vehicular_2017/vehicular_2017_2_40_30053.pdf)
- [Recipes for Calibration Checks in Safety-Critical Applications](https://arxiv.org/abs/2604.26479)
- [How to undervolt your graphics card with GPU Tweak III](https://rog.asus.com/articles/guides/how-to-undervolt-your-graphics-card-with-gpu-tweak-iii-for-lower-temperatures/) — checked and found NOT to be an authority: no promotion gate exists in consumer tuners
- Local: `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R16 · R17 · `plans/13` §4 · EXP-0057 · EXP-0082 · `bugs/133`
