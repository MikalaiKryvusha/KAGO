# KAIF improvement request: `diff --source` counts an intentionally adapted module as an upstream change — and never names the module

kaif-fp: `kaif-core.mjs cmdDiff --source` :: adapted-module-counted-as-upstream-delta + unnamed-delta :: v2.2

**Delivered upstream:** folded into the KAGO 2.2 update field report issue (see
`reports/KAIF_UPDATES/KAGO_KAIF_2.2_UPDATE_REPORT.md`); a separate issue is the owner's call.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.2 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (`ls bugs/KAIF/` → tickets 01–03, none about `diff`) and
origin issues (`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 30` → 9 issues; #3, #4,
#6 are this project's earlier improvements, #8/#9 concern legacy update and a 1.6→2.2 migration —
none mention the diff preview). No match found.

## Gap

Two halves, one loop — `kaif-core.mjs:2353-2359`:

1. **The preview names files, never modules.** On a routine pre-update audit the command printed:

   ```
   $ node .kaif/kaif-core.mjs diff --source https://github.com/MikalaiKryvusha/KAIF/releases/download/v2.2
   diff vs 2.2: 1 file(s) carry upstream static-module changes; 67 — nothing to do
     Δ AGENT_GUIDE.md — 1 static module(s) differ
   ```

   Which of the 28 modules of `AGENT_GUIDE.md`? The command has no flag for that (`--source
   --baseline --lang` are the only known flags; `--verbose` is refused per the bug-33 policy).
   Identifying the module took a patched debug copy of the core with a `log()` inserted into the
   loop — roughly half an hour of archaeology for one line of output the machinery already had in
   hand: `· upstream static "## Project identity (CANON — use these, don't invent)" — sha differs
   from snapshot`.

2. **The counted delta was not an upstream change at all.** The loop counts a module when the
   *upstream* class is `static` and the snapshot sha differs — but it never consults the
   *snapshot's own class* for that module. In this deployment the snapshot records the module as
   `adaptive`:

   ```json
   {"signature":"## Project identity (CANON — use these, don't invent)","class":"adaptive","sha256":"c2b058ba…"}
   ```

   because the installer adapted it at deploy time (the project added its acronym expansion
   paragraph; the disk module is a strict superset of the upstream template). An intentional,
   installer-recorded adaptation is therefore reported under the heading "carry **upstream**
   static-module changes" — a false alarm that will fire on **every** future preview of this
   deployment, and the one place it fires (the pre-update audit) is exactly where a false "upstream
   changed this" claim is most expensive to double-check.

## Field evidence

KAGO, 2026-08-14, routine `/kaif-update` pass while already on 2.2. Full timeline in
`reports/KAIF_UPDATES/KAGO_KAIF_2.2_UPDATE_REPORT.md` §2 — including the proof that no upstream
drift existed: the v2.2 release assets were all created `2026-08-09T15:44:16Z` and the deployment
was installed from them at `2026-08-09 21:50:37 +03:00` (18:50 UTC), *after* that cut; the deployed
machinery is byte-identical to the release asset (sha256 `4924f562…` both sides).

Secondary observations from the same pass, same command, listed here so they are not lost:

- `diff --source <bare repo URL>` fails with `✖ download failed (404) —
  https://github.com/MikalaiKryvusha/KAIF/kaif-manifest.json`. Cheap kindness: when the URL matches
  `github.com/<owner>/<repo>` with no path, resolve it to `<url>/releases/latest/download` — the
  same base `update` already uses.
- After that `die()`, Node crashed on exit: `Assertion failed: !(handle->flags &
  UV_HANDLE_CLOSING), file src\win\async.c, line 76` (Node v24.15.0, win32). Cosmetic — the error
  message had already printed — but it reads as a second failure. Likely an in-flight fetch handle
  at `process.exit()`.

## Proposed change (smallest that closes the gap)

1. **Name the delta.** One `log()` per counted module, printing its signature and which side moved:
   `· "## Project identity …" — upstream sha differs from snapshot` / `— vanished upstream`. The
   loop already holds both objects; the cost is zero.
2. **Consult the snapshot's class.** When the snapshot records the module as `adaptive`, report it
   as `kept: locally adapted at deploy` (and do not count it into "upstream static-module
   changes") — the update would respectfully keep it anyway, so the preview should say what the
   update will do, not raise an alarm the update will ignore.

## Expected effect and its check

A pre-update preview on a deployment with an adapted module prints the module's signature and
labels it `kept`, and the "upstream static-module changes" count is 0 when upstream is unchanged.
Check: run `diff --source <current release>` on any deployment whose adaptation touched a module
the map classes static — today it reports 1 phantom delta; after the change it reports none and
names the kept module.

Invariant served: **the preview predicts the pass** — `diff --source` exists so the update holds no
surprises; a preview that flags what the update will not touch, without naming it, sends the
operator to do archaeology the machinery could have printed in one line.

## Local remediation

None needed — the flagged module is correct on disk (project content, deliberately added at
install) and the update correctly left it alone. The debug copy used to name the module lived in
the session scratchpad and was never part of the tree.
