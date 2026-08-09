# KAIF improvement request: the placeholder gate counts the sphere library, but the task item does not list it

kaif-fp: `KAIF_ADAPTATION_TASK.md#placeholders` + `kaif-core.mjs checkpoint placeholders` :: gate-scope-wider-than-instruction :: v2.2

**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/3 — filed 2026-08-09 on the
owner's approval (chat), under the owner's account.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.2 · project KAGO · sphere `programming` · language `ru` ·
i18n 8 owner docs localized · tracking `origin` · agent system claude-code (+4 mirrored) ·
OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (`ls bugs/KAIF/` → directory did not exist; this is its
first ticket) and open origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state open --search "placeholder spheres gate"` → no
results; `--state all --limit 20` → 2 issues, both CLOSED and unrelated: #1 anonymous-install mode,
#2 interactive-contour field notes). No match found.

## Gap

The adaptation task item enumerates, by name, every file holding each placeholder — and presents
that list as authoritative:

> **placeholders** — Fill the remaining placeholders at their REAL locations (each verified on disk
> at generation time; grep to be sure): … `<BUILD_COMMAND>` → AGENT_GUIDE.md,
> .claude/skills/autoloop/SKILL.md, .claude/skills/dayloop/SKILL.md, .claude/skills/nightloop/SKILL.md …

The gate behind `checkpoint placeholders` scans the whole tree instead, and the sphere library is
inside its scope while being outside the item's list. The parenthetical "grep to be sure" is the
only hint that the list is not complete — and it reads as a caution against typos, not as a warning
that the list omits a location.

The omission looks deliberate on the machinery's side: `kaif-core.mjs:1362` carries the comment

> `// libraries that carry template slots BY DESIGN (bugs/36, project B Г11: a literal <BUILD_COMMAND>`

so the sphere library is *known* to hold template slots — yet `checkpoint placeholders` still counts
one as an unfilled placeholder.

## Field evidence

KAGO, 2026-08-09. All four listed locations were filled, mirrors re-synced, then:

```
$ node .kaif/kaif-core.mjs checkpoint placeholders
↻ re-synced 152 system skill copies from the canon
✖ placeholder <BUILD_COMMAND> still in .kaif/spheres/programming.md
✖ checkpoint placeholders REFUSED: 1 literal placeholder(s) remain on disk (listed above) — fill them in the canonical copies, then re-run
```

The offending line, `.kaif/spheres/programming.md:17`:

```
| build | compiling/packaging the product (`<BUILD_COMMAND>`) |
```

Cost: one refused checkpoint, roughly three minutes. **Low severity, and the gate behaved well** —
it named the exact file, so recovery needed no investigation. This is filed as an improvement rather
than a bug because nothing broke and nothing shipped wrong.

The residual risk is not the lost minutes. It is that an item which promises "REAL locations,
verified on disk" and then proves incomplete teaches a weak session to distrust the task file's
other lists — and those other lists are load-bearing.

## Proposed change (smallest that closes the gap)

Pick either half; both close it.

1. **Make the list complete** — the generator already knows which files carry each placeholder, so
   add `.kaif/spheres/<sphere>.md` to the `<BUILD_COMMAND>` row when a sphere library is deployed.
2. **Or make the gate's scope match its own comment** — exempt the sphere library from the
   placeholder scan, since `kaif-core.mjs:1362` already classifies its slots as intentional
   templates.

Option 1 is preferable: the sphere library's `<BUILD_COMMAND>` *should* be filled — a deployed
sphere describing "the build" with a literal placeholder is a worse document than one naming the
project's actual command. The defect is the missing list entry, not the gate.

## Expected effect and its check

A deployment that fills exactly the locations the item names passes `checkpoint placeholders` on the
first run. Check: on a fresh install, `grep -rn "BUILD_COMMAND" --include="*.md" .` restricted to the
item's listed paths returns the same set the gate scans (minus `.kaif/install/`).

Invariant served: **cold-start** — a fresh session must be able to trust the task file's own
statements about where things are.

## Local remediation

Filled `.kaif/spheres/programming.md:17` with the project's real command (`npm run check`); the
checkpoint then passed. Not mutation-proved — the gate's own refusal is the proof, and it is
deterministic. The divergence from the shipped template is a one-cell edit and will reconcile
trivially at the next `/kaif-update`. Lesson captured as `EXPERIENCE.md` → `EXP-0002`.
