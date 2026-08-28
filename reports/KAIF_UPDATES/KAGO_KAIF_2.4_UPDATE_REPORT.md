# KAGO — KAIF 2.3 → 2.4 update report (core-update route, second mechanical pass in 24 h)

> **Created:** 2026-08-28 · **Parent:** owner's order (chat, 2026-08-28: "Обнови KAIF до версии 2.4
> из origin — уважительная миграция") · **Status:** update VERIFIED WITH CAVEATS, tree green ·
> **Outbound:** this report + `bugs/KAIF/10` → origin, for the 2.5 scope (owner's word: «Оба отчёта
> заберёт исток»).

## 1. Chronology with numbers

- **13:5x** Pre-flight: tree clean at `5ac61be`, `.kaif/kaif.json` = 2.3, tracking `origin`.
- **13:5x** `diff --source <origin>` preview: **2.4 upstream; 12 files carry static-module changes,
  56 nothing to do**. Bare repo URL auto-resolved to release assets (the 2.3 fix holding).
- **13:5x** Sandbox rehearsal (skill step 2, the heavy-localization branch): `git archive` → temp
  copy → the REAL `update` there. Result: same counters as live, **KAIF_UPDATE_TASK.md with
  11 items, 1 file awaiting manual merge**. Live later matched the sandbox in composition —
  the rehearsal again cost ~2 minutes and removed all surprise.
- **13:58** Live `node .kaif/kaif-core.mjs update`: **2.3 → 2.4**; pre-update backup 79 files;
  crash journal written and self-removed on success; merged 3 modules into AGENT_GUIDE.md
  (1 kept for us), replaced 7 skill files, merged 8 modules total, added the 2.4 skeleton
  (team-deployment + 3 reference templates, end-chat-force, end-chat-soft) across all 5 agent
  dirs; machinery self-replaced.
- **14:0x** Cognitive part, all 11 task items: policy changes surfaced verbatim in chat; the
  AGENT_GUIDE top merged by hand (creed added in ru with the owner's name, ONE prayer — the
  localized интервью-017 module kept, template duplicates folded out, named-time rule kept);
  PROJECT_HISTORY.md header re-pointed to `/end-chat-soft` (chronicle entries kept verbatim);
  old `/end-chat` removed in 5 dirs; `<YOUR AGENT/MODEL>` + noreply slots filled in
  end-chat-soft; version claims bumped in KAIF_FRAMEWORK.md and both README halves.
- **14:0x** Gates: `npm run check` — 57 .mjs parse, 436 text files encoding-clean, prayer tool
  reports 12/12 canon copies matching source. `npm run selftest:all` — **29 sets, 0 red,
  1421 green blocks, 17.0 s** (identical to pre-update STATUS numbers). `kaif-core.mjs check` —
  **manifest satisfied: 85 files + 152 agent artifacts**; checkpoints re-synced **169** mirror
  copies. All 11 checkpoints recorded; judge verdict in the receipt.

## 2. Rakes

### R1 (the one ticketed defect): the placeholders task item lists verbatim QUOTES as fill locations

Severity: low; cost ~10 min of verification. The generated item said `<BUILD_COMMAND>` →
EXPERIENCE.md, KAIF_FRAMEWORK.md — both are verbatim quotes of the 2.2 refusal (lesson EXP-0002
and the deployment record), not slots; "filling" them would falsify append-only history. The GATE
already skips quotes since the 2.3 fix and ran clean:

```
✔ placeholder scan ran clean (executed by the checkpoint itself; mirrors re-synced first)
```

In 2.2 the gate was wider than the instruction (`bugs/KAIF/01`, origin #3); now the instruction is
wider than the gate — the asymmetry changed sides, one shared predicate would end it. Ticket:
**`bugs/KAIF/10`** (not fixed silently; nothing on disk needed remediation).

### R2 (not a defect, worth naming): the mechanical merge plants the ENGLISH prayer INSIDE the localized prayer markers

On an i18n `ru` deployment the module merge inserted the English template prayer + duplicated
PRIME/AUTONOMOUS blocks between our `KAIF:PRAYER:BEGIN` marker and the Russian block, leaving TWO
`KAIF:PRAYER:END` markers until the manual merge:

```
<!-- KAIF:PRAYER:BEGIN — ОДИН ИСТОЧНИК: PHILOSOPHY.md ... -->
## 🙏 THE PRAYER BEFORE WORK        ← English template arrival
...
<!-- KAIF:PRAYER:END -->             ← first END
...
## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ          ← our localized block
...
<!-- KAIF:PRAYER:END -->             ← second END
```

The updater PRINTED the honest warning (ru pack incomplete by design, arrivals in English), the
task file carried the module diff, and the state is exactly "manual transfer pending" — so this is
the documented contract, not a bug. But any project with its own marker-driven tooling (ours:
`tools/prayer.mjs` rewrites between the FIRST BEGIN/END pair) sits one unlucky `--apply` away from
truncating the file top between merge and manual fold. Survived here because the merge is
transactional and we merged by hand immediately. Recorded as a signal, no ticket: the fix rides
the R1 pattern (marker-aware merge on i18n deployments would place arrivals AFTER the closing
marker, not inside the pair).

### R3 (kindness worth naming): the 2.3 EOL rake did not reproduce

2.3's merge wrote LF into a CRLF tree (`bugs/KAIF/06`); 2.4's release notes claim the fix
("merge/replace preserves the FILE's end-of-line convention") and the pass confirmed it — git's
CRLF warnings on touched files are the autocrlf norm, no mixed-endings corruption, encoding guard
green over 436 files.

## 3. What was exercised vs NOT

**Exercised:** `diff --source` preview · sandbox-copy rehearsal (byte-matched composition) · the
`core-update` route · pre-update backup + crash journal lifecycle (success path) · module merge
into locally-edited canon incl. the i18n manual-transfer branch (creed + named-time + prayer
dedup) · deprecation with local edits (end-chat, 5 dirs) · placeholder slots + the quote-skip
gate · stale-claims scan (clean after 3 edits) · all 11 checkpoints · mirror re-sync (169) ·
judge verdict via `--verdict-file` · this report.

**NOT exercised:** the thin-`KAIF.md` bootstrap route · crash-mid-update + `resume` (journal only
seen on the success path) · the new `/team-deployment` skill (delivered; first use is the NEXT
task of this same session — a separate report will cover it) · `/end-chat-force` and
`/end-chat-soft` in anger · the named-time contract in a live loop · localization transfer of the
English arrivals beyond the guide top (accepted in English as-is, agent-read docs).

## 4. Wishes for the next version (by cost, descending)

1. **One placeholder predicate, two callers** (closes `bugs/KAIF/10`): the task generator should
   filter locations through the same quote-skip the gate got in 2.3.
2. **Marker-aware i18n merge** (closes R2's residual risk): on a deployment whose language pack
   skips a file, place the English module arrival AFTER the localized block's closing marker —
   never between a BEGIN/END pair the project's own tooling rewrites.
3. **Cheap:** the update summary line could count deprecations it could NOT remove (edited copies)
   the way it counts merges — ours was findable only by reading the task file.

## 5. Final state and the judge verdict

`.kaif/kaif.json`: version **2.4**, released 2026-08-28, history 2.2→2.3→2.4, tracking `origin`.
Manifest 85 + 152 green; selftest battery 29/0/1421; encoding guard 436/0; prayer 12/12 copies
match source. Policy changes adopted on the owner's update order, surfaced in chat, veto open.

Judge verdict, verbatim (full text in `.kaif/last-update.json` receipt):

> FABLE-JUDGE VERDICT on the KAIF 2.3 → 2.4 update (KAGO, 2026-08-28): VERIFIED WITH CAVEATS.
> [claims 1–5 all CONFIRMED by re-run: versions stamped · nothing owner-authored lost · merges
> real (one creed pair, one prayer pair, no duplicated blocks) · project works (29/0/1421,
> manifest 85+152) · deprecation done]. Caveats: English-first arrivals stay English in agent-read
> docs and the prayer cadence intentionally diverges on the owner's word (интервью 017 Q2 = B);
> the two 2.4 policy changes await the owner's separate ratification; the STATUS bonsai debt is
> pre-existing; one framework defect ticketed, not silently fixed (bugs/KAIF/10).

**`update-verify` postscript:** passed with 3 warnings "promised upstream line not found" — the
English creed heading, the English `BELIEVE IN THE PRODUCT…` line and the bare
`<!-- KAIF:PRAYER:BEGIN -->` marker. All three are absent BY THE TEMPLATE'S OWN ORDER: the creed
comment says "render the creed in the owner's language" (ours is ru), and our prayer marker carries
the `tools/prayer.mjs` source-of-truth suffix. The STATUS/GOAL "MODULE ABSENT" lines are the known
pre-existing shape of a fully localized owner canon (upstream bug 26), unchanged by this pass.

## Сигналы в исток (signals to origin)

1. `bugs/KAIF/10` — placeholders item vs gate asymmetry, second edition (instruction now wider
   than gate). Smallest fix: shared quote-skip predicate.
2. R2 — the i18n merge plants English arrivals INSIDE localized marker pairs; marker-aware
   placement would make the manual-transfer state safe for projects with marker-driven tooling.
3. R3 — positive confirmation: the 2.4 EOL fix works on a CRLF Windows tree (bugs/KAIF/06 closed
   in the field).
4. Positive: the sandbox rehearsal branch of `/kaif-update` step 2 paid for itself twice running
   (2.3, 2.4) — composition matched live both times; keep it recommended for localized trees.
5. The 2.4 update-time guarantees (backup tree, crash journal) were OBSERVED live on this pass
   already — the route note in `/kaif-update` ("next interval") undersells the core-update route
   when the deployed core is one release behind: our 2.3 core already carried them. Wording nit
   only.
