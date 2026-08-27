# KAIF improvement request: incident response is fixed at maximum — every defect earns the full package, so the protection machinery grows without bound and starts producing the majority of defects itself

kaif-fp: `BUG_FIXING_FRAMEWORK.md` + `TESTING_FRAMEWORK.md` guards contract :: no-proportional-response :: v2.3

**Delivered upstream:** NOT YET — awaiting the owner's word (outward action).

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.3 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (01–06 — different surfaces) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 40`, 2026-08-28 → 24 issues; #14
«механизация урока оплачивается вторым ожогом» argues FOR mechanizing lessons and is about the
lesson channel, not about scaling the response to severity). No match found.

## Gap

The canon mandates one response size for every defect: a bug document + a guard proven red + the
twin sweep + class closure + a lesson — and the guards contract adds mutations. Severity is never
consulted. Two consequences follow mechanically:

1. **Cost per incident is O(full package)** regardless of what the incident cost. A papercut and a
   machine-killing write receive the same funeral.
2. **The machinery compounds:** each guard is code, code has defects, each defect earns another full
   package. Past a threshold the protection layer becomes the project's main defect source — while
   consuming the budget of the product it protects.

## Field evidence (KAGO, 68 classified bug documents)

- **65 % of all bugs (44/68) are defects OF the protection/verification machinery** (guards,
  watchdog, safe-mode, tidy hook, bench, dashboard, journal bookkeeping, status hygiene) — not of
  the product path (18) and not of the domain (6).
- Of 42 bugs that cost or blocked a live owner-present evening, **25 are machinery defects**: the
  guards consumed more scarce live-GPU time than the tuning code they guard.
- Guard-vs-guard incidents: two CORRECT rules cancelled each other (EXP-0104); a guard reddened on
  the machinery's normal operating state (EXP-0076, rule R17); a working guard was retired on a
  false «all findings false» diagnosis (bugs/40); the watchdog heartbeat killed the writer it
  guarded (bugs/19); the tidy hook killed a live sweep (bugs/21).
- Open-bug tail does not converge: 29 open after 19 days, because closing a cosmetic defect costs
  the same as closing a killer.
- Detection asymmetry: the 1,404-block offline battery found 13 % of new defects; the owner's eye
  plus live runs found 60 % — the most expensive detector in the project does the work the cheap
  one was built for.

## Proposed change

A **severity ladder** in `BUG_FIXING_FRAMEWORK.md`, consulted at filing time:

- **S1** — hardware/machine/measured-data/owner-trust harmed → the full package as today.
- **S2** — a run or an hour lost → bug document + guard; no epic, no new canon section.
- **S3** — everything else → one EXPERIENCE line; no bug document.

Plus one cap: **an incident never opens an epic by itself** — an epic must additionally pass the
delivery test of ticket 07. Plus one collapse rule: a lesson that has become a mechanical guard is
collapsed to one line + pointer (today both full texts persist and both are maintained).

## Local remediation

KAGO adopts the ladder as rule Р2 of the method audit
(`reports/KAIF_AUDIT/2026-08-28_audit_03_method.md` §6), pending the owner's approval.
