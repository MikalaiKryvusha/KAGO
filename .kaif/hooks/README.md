# .kaif/hooks — the optional refresh-hooks module

The context-refresh canon (AGENT_GUIDE.md → "Context refresh") is a **markdown ritual — complete
and self-sufficient on its own**: four triggers, the two-part witness (marker + acceptance
quote), the judge hunt. This module is the OPTIONAL second contour on top of it: on agent
systems that support lifecycle hooks, the same triggers become **mechanical injections** the
session cannot forget. A deployment without hooks is not degraded and never reddens for
lacking them.

## What ships here

| Script | Event (Claude Code) | Predicate (anti-noise) | Action |
|---|---|---|---|
| `session-start-refresh.mjs` | `SessionStart`, matcher `compact\|clear` | none — compaction is itself rare | injects the ORDER to re-read the re-read core + stamp the witness |
| `prompt-refresh-timer.mjs` | `UserPromptSubmit` | marker age > 60 min (`--minutes N` to override) | injects the refresh order; silent while the marker is fresh |
| `stop-status-guard.mjs` | `Stop` | session did work AND STATUS.md untouched > 3 h; **once per session** | soft block: update STATUS.md or say why nothing changed |

Design rules baked in (they are canon requirements, not preferences): every hook carries a
predicate and a cooldown; injections are ORDERS to re-read, never document bodies (the output
cap is 10 000 characters, and pasting docs would spend the context the refresh restores);
`Stop` is the only blocking hook, and even it fires at most once per session. A hook never
breaks the session: on any internal error it exits 0 silently.

## Opt-in — an explicit owner step

**KAIF never edits your `settings.json`.** Wiring hooks changes how your agent system behaves
on every prompt — that is the project owner's decision, exactly like `.gitattributes` or CI
config. To enable:

1. Open `.kaif/hooks/settings-fragment.json` — it carries the ready `hooks` object.
2. Merge that object into `.claude/settings.json` (shared with the team, committed) or
   `.claude/settings.local.json` (personal), with the owner's consent recorded where your
   project records decisions.
3. Reload the session (hook configs are read at session start). Smoke: run
   `node .kaif/hooks/prompt-refresh-timer.mjs` with no `.kaif/refresh-marker.json` present —
   it must print a JSON order; stamp a fresh marker — it must print nothing.

To disable: remove the entries from your settings file. The markdown ritual keeps working
either way.

## Other agent systems

**The scripts are one implementation; only the wiring is per-system.** Each system names its own
config file, its own event names, and its own envelope for injected context — so the scripts take
`--emit <shape>` and the SAMPLE names the shape explicitly. Nothing is auto-detected: a hook must
exit silently on anything unclear, so a wrong guess would fail invisibly, while a wrong flag in a
sample is visible to a human reading it.

Contracts below were read in each vendor's live documentation on **2026-08-07**. Treat any row
older than a few weeks as a hypothesis and re-read the vendor doc before relying on it — hook
APIs were still moving through beta across the industry when this table was written.

| System | Sample | Canon after compaction | Hourly timer | STATUS guard |
|---|---|---|---|---|
| **Claude Code** | `settings-fragment.json` | ✅ | ✅ | ✅ |
| **OpenAI Codex** | `sample-codex-hooks.json` | ✅ same field names, matcher on `source` | ✅ | ❌ output shape of `Stop` not verified |
| **Cursor** | `sample-cursor-hooks.json` | ✅ `additional_context` | ❌ `beforeSubmitPrompt` cannot inject agent context | ❌ `stop` auto-submits a followup prompt instead |
| **Google Antigravity** | `sample-antigravity-hooks.json` | ❌ no session/compaction event exists | ✅ `PreInvocation` → `injectSteps` | ❌ field names match, blocking value not verified |
| **GitHub Copilot** | `sample-copilot-hooks.json` | ✅ `additionalContext` on `sessionStart` | ❌ injection not permitted on `userPromptSubmitted` | ❌ not permitted on `agentStop` |
| **Grok Build** | *(none needed)* | ⚠️ reads `.claude/settings.json`; **injection not verified** | ⚠️ same path, same gap | ⚠️ same path, same gap |
| **Meta Muse Code** | *(none yet)* | ❌ no such event found | 🟡 a prompt event exists; contract not published | ❌ |
| **Windsurf / Cascade** | *(not supported)* | ❌ | ❌ | ❌ hooks cannot inject context at all — exit codes only |
| **Cline** | *(not supported)* | ❌ | ❌ | ❌ hooks are SDK plugins (TS/JS objects), not config-invoked commands |
| **Zoo Code** | *(markdown ritual)* | — | — | — no hook mechanism |

Reading the table: a ❌ is a statement about that system's published contract, not about the
module. Where a system carries one hook out of three, wire that one — a partial mechanical
contour plus the markdown ritual is strictly better than the ritual alone, and the ritual is
complete by itself in every row.

**Grok Build needs no sample of its own:** its docs state that `.claude/settings.json` and
`.cursor/hooks.json` are read alongside its native `.grok/hooks/*.json`. Use the Claude Code
fragment as-is. One caveat worth knowing: in Grok's NATIVE contract the session/prompt/compaction
events are passive ("stdout is ignored"), so whether it honours `additionalContext` on the
Claude-compatible path is unverified — if the order never appears in your session, that is the
first thing to test.

**Meta Muse Code** (beta since 2026-08-05) documents hooks with a prompt-submission event and its
own trust model — project and user hooks must be explicitly trusted before they run. No sample
ships until the vendor publishes the contract: a config written from overviews would look like
delivery and behave like a guess.

**Adding a system yourself:** read its live hook docs, find (1) the event that fires after context
is lost or per turn, and (2) the exact output field that injects context into the AGENT — not a
message to the human. If (2) does not exist, the system cannot carry this module, and the markdown
ritual is the honest answer, not a lesser one. If it does, add a shape to the `ENVELOPES` table in
the relevant script and a sample next to these.
