# KAGO — KAIF 2.2 update field report (a verified no-op, and what the verification cost)

> **Pass:** `/kaif-update` to the latest origin release, requested by the owner · **Date:** 2026-08-14
> **Agent:** Claude Fable 5, VS Code CLI · **Host:** Windows 11 Pro 10.0.26200, Node v24.15.0
> **Deployment:** KAIF 2.2 · tracking `origin` · lang `ru` · agents claude-code (+4 mirrored)
> **Outcome:** the deployment was already at the latest release; every byte verified, nothing changed.
> The same session verified the stylometric voice core against its own origin — also current.

---

## 1. Chronology with numbers

| Step | Command | Result |
|---|---|---|
| Pre-flight | `git status --porcelain` | clean tree |
| Deployed version | `node .kaif/kaif-core.mjs version` | `KAIF 2.2 (released 2026-08-08) · tracking: origin · lang: ru` |
| Origin releases | `gh release list --repo MikalaiKryvusha/KAIF` | `v2.2 … Latest … 2026-08-08T20:29:49Z` — no newer release exists |
| Preview | `diff --source …/releases/download/v2.2` | `1 file(s) carry upstream static-module changes; 67 — nothing to do · Δ AGENT_GUIDE.md — 1 static module(s) differ` |
| Update | `node .kaif/kaif-core.mjs update` | `✅ already up to date (KAIF 2.2)` |
| Machinery integrity | `Get-FileHash` both sides | `.kaif/kaif-core.mjs` = release `KAIF-CORE.mjs` = sha256 `4924f56260630f944b9b56273c59638dece0ec3e7c3c46475b68aacccf81fc94` |
| Manifest health | `node .kaif/kaif-core.mjs check` | `✅ manifest satisfied: 79 files + 144 agent artifacts present` (plus a soft STATUS.md bonsai warning, pre-existing) |

The mechanical half took four commands. The cognitive half was the one flagged Δ — §2.

## 2. The single Δ: archaeology of one line of output

The preview flagged one static module in `AGENT_GUIDE.md` and did not say which. Naming it required
copying the core into the session scratchpad, inserting one `log()` into the diff loop
(`kaif-core.mjs:2353-2359`) and re-running:

```
· upstream static "## Project identity (CANON — use these, don't invent)" — sha differs from snapshot
```

Was it upstream drift? The timeline says no, on three independent facts:

1. The v2.2 release assets were all created `2026-08-09T15:44:16Z` (`gh release view v2.2 --json assets`).
2. This deployment was installed at `2026-08-09 21:50:37 +03:00` = 18:50 UTC (`git log`, commit
   `9aa580d chore: deploy KAIF`) — **after** the asset cut, so it was installed *from* these very bytes.
3. The deploy snapshot records the module as `class: "adaptive"` — the installer adapted it at
   deploy time (the project's acronym-expansion paragraph; the disk module is a strict superset of
   the upstream template), and the update correctly protects it.

So the Δ is this project's own intentional adaptation, reported under the heading "upstream
static-module changes." The update's *behaviour* was right (keep the adapted module); the preview's
*story* was wrong, and proving it wrong cost about half an hour. Filed as
`bugs/KAIF/04_diff_preview_counts_adapted_module_and_names_no_module.md` with the smallest fix:
print the module signature per delta, and report snapshot-adaptive modules as `kept`, not counted.

## 3. Rakes and kindnesses beyond the Δ

- **Bare repo URL → unhelpful 404.** `diff --source https://github.com/MikalaiKryvusha/KAIF` fails
  with `✖ download failed (404) — …/KAIF/kaif-manifest.json`. Resolving a bare `github.com/<o>/<r>`
  URL to `releases/latest/download` (the base `update` already uses) would make the first guess work.
- **libuv assertion on exit after that 404**: `Assertion failed: !(handle->flags &
  UV_HANDLE_CLOSING), file src\win\async.c, line 76` (Node v24.15.0, win32). Cosmetic — the real
  error had printed — but it dresses one failure as two. Both folded into ticket 04.
- **Same-version asset revisions are invisible by design.** The v2.2 assets carry a timestamp 19
  hours after the release was published (2026-08-08T20:29:49Z → 2026-08-09T15:44:16Z). This
  deployment happened to install after the cut; a deployment installed before it could never
  receive the delta mechanically, because `update` bails on the version string alone. If asset
  re-cuts within a version are ever intended practice, `kaif-manifest.json` wants an asset-revision
  stamp that `update` compares. Left as an observation, not a ticket — from the outside, a late
  first upload and a re-cut are indistinguishable.
- **Praise where due:** the unknown-command refusal (`✖ unknown command: check-updates` and
  `✖ unknown flag for diff: --help`, the bug-33 policy) behaved exactly as designed — loud, safe,
  and it printed the command list instead of doing something unasked. And `update` re-verified
  sha256 on every fetch.

## 4. Same session: the stylometric voice core, verified against its origin

The owner also asked to refresh the voice core from
`https://github.com/MikalaiKryvusha/krinik-stylometry`. Verification made it a no-op:

| Check | Result |
|---|---|
| Origin HEAD | `ce018c9 feat: круг 5 — АП27–АП37 …, версия ядра 1.1` + `3795c1e docs: corpus registry` (2026-08-08T23:13:50Z) |
| Origin `version.json` | `"version": "1.1", "released": "2026-08-09", "status": "accepted"` |
| Local vs origin | `git hash-object AUTHOR_STYLOMETRY.md` = `40cfe9095b38d1b50743000b9b7293a69b999514` = origin blob sha — byte-identical |
| Round-5 content | АП27 (line 3760) … АП37 (line 3800) and the round-5 journal entry (line 4802, «Версия ядра — **1.1**») present on disk |

The local portrait **is** core 1.1 at origin HEAD. (Its header still says «версия ядра 1.0» at
line 7 — that line records the *acceptance* event of round 4; the version ledger at the bottom
carries 1.1. An observation for the voice repo, not for KAIF.)

## 5. Same session: the optional refresh-hooks module wired in (owner's explicit order)

Mid-session the owner ordered, verbatim: «убедись что опциональный модуль хуков подключен». The
module (`.kaif/hooks/`, shipped with 2.2) was present but not wired — no `.claude/settings.json`
existed. Wired per the module's own README: the `hooks` object from
`.kaif/hooks/settings-fragment.json` merged into a new project-shared `.claude/settings.json`,
consent recorded in the file's header comment and in `STATUS.md`. Smoke, all four probes green:

| Probe | Expected | Observed |
|---|---|---|
| `prompt-refresh-timer.mjs`, no marker | JSON refresh order | order printed, `additionalContext` present |
| same, fresh marker | silence | empty stdout, exit 0 |
| `session-start-refresh.mjs`, `source: compact` | re-read order | order printed |
| `stop-status-guard.mjs` | silent (STATUS touched today) | empty stdout, exit 0 |

One field note for the module's README: the scripts read stdin with `readFileSync(0)`, which
blocks until EOF — a bare smoke run without piped stdin (the README's step 3 suggests running the
script with no input) hangs in shells that keep the descriptor open. Piping `{}` is the reliable
smoke. Hooks load at session start, so the contour goes live from the next session.

## 6. Judge verdict

Every claim above was re-run fresh in one consolidated pass (C1–C7) after the investigation:
version, update no-op, machinery sha, manifest check, portrait blob sha, clean tree. Verbatim:

> **VERIFIED.** C1 `KAIF 2.2 · tracking: origin` reproduced; C2 `✅ already up to date (KAIF 2.2)`
> reproduced; C4 sha256 `4924f562…` identical on both sides; C5 `✅ manifest satisfied: 79 files +
> 144 agent artifacts present`; C6 `40cfe909…` equals the origin blob sha of
> `AUTHOR_STYLOMETRY.md`; C7 `git status --porcelain` empty before the report files were written.
> The one Δ the preview reported was traced to an installer-recorded adaptive module, with the
> asset-cut and install timestamps proving no upstream drift. No claim rests on memory; every
> number above is a command's output from this session.
