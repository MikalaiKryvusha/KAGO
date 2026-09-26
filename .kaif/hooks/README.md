# .kaif/hooks — the optional refresh-hooks module

The context-refresh canon (AGENT_GUIDE.md → "Context refresh") is a **markdown ritual — complete
and self-sufficient on its own**: four triggers, the two-part witness (marker + acceptance
quote), the judge hunt. This module is the OPTIONAL second contour on top of it: on agent
systems that support lifecycle hooks, the same triggers become **mechanical injections** the
session cannot forget. A deployment without hooks is not degraded and never reddens for
lacking them.

## What ships here

| Script | Event (Claude Code) | Predicate (anti-noise) | Repeats? | Action |
|---|---|---|---|---|
| `session-start-refresh.mjs` | `SessionStart`, matcher `compact\|clear` | none — compaction is itself rare | one order per compaction or clear | injects the ORDER to re-read the re-read core + stamp the witness |
| `prompt-refresh-timer.mjs` | `UserPromptSubmit` | marker age > 60 min (`--minutes N` to override) | on EVERY prompt until the marker is re-stamped — the marker is the only off switch | injects the refresh order; silent while the marker is fresh |
| `stop-status-guard.mjs` | `Stop` | session did work AND STATUS.md untouched > 3 h | **once per session** — the only suppression window in the module | soft block: update STATUS.md or say why nothing changed |
| `prompt-resume-word.mjs` (2.7, epic RS) | `UserPromptSubmit` | the prompt's FIRST word is `resume` / `/resume` / the Russian shorthand of it — the owner's leading word (`AGENT_GUIDE.md` → "A leading skill word is an order"); the same word mid-sentence is prose and never fires; an imperative before it (`run resume`, its Russian mirror) is still the order, the Russian noun as a heading with a colon is prose (2.8) — any other first word from the family fires, including a file named `resume.log`: one extra entry ritual is the named price. **2.8, epic OW:** a leading `stop` (or its Russian word) → the order to stop in this turn — an amplifier of "The owner's word mid-turn": a hook firing on a message typed mid-turn is observed on one system, promised by none | on every message that opens with the word — each one is a separate order | injects the ORDER to run `/resume` in full before the rest of the message, or the ORDER to stop; silent on every other prompt and on an event without a `prompt` field |
| `pretool-owner-word.mjs` (2.8, epic OW) | `PreToolUse` (every tool call of the main thread) | the owner's LATEST message typed mid-turn (`queued_command`, `origin.kind: human` in the transcript) has no assistant TEXT block after it — reasoning is not delivered (origin bug 123, recurrence 2026-09-25) | ONCE per owner's message: the first tool call after it with no text answer yet is refused, the next passes — the work goes on (the origin owner's word, 2026-09-25); a subagent's call (`agent_id`) and a peer's message are silent; `KAIF_OWNER_WORD_GATE=off` switches it off | **blocks** the call (exit 2); the reason quotes the owner's words and says: answer AS TEXT by its kind, continue, repeat the answer in the turn's final text |

Design rules baked in (they are canon requirements, not preferences): every hook carries a
predicate, or names why it needs none, and the table above says which; a suppression window
exists where repeating would be noise (`Stop` fires at most once per session) and is absent ON
PURPOSE where repeating is the point — a reminder that goes away unobeyed teaches that it can be
ignored, so the timer repeats until the marker is re-stamped, and every message that opens with
the resume word is a separate order; injections are ORDERS to re-read, never document bodies
(the output cap is 10 000 characters, and pasting docs would spend the context the refresh
restores); `Stop` is the only blocking hook. A hook never breaks the session: on any internal
error it exits 0 silently.

## Opt-in — an explicit owner step

**KAIF never edits your `settings.json`.** Wiring hooks changes how your agent system behaves
on every prompt — that is the project owner's decision, exactly like `.gitattributes` or CI
config. To enable:

1. Open `.kaif/hooks/settings-fragment.json` — it carries the ready `hooks` object.
2. Merge that object into `.claude/settings.json` (shared with the team, committed) or
   `.claude/settings.local.json` (personal), with the owner's consent recorded where your
   project records decisions.
3. Reload the session (hook configs are read at session start), then smoke the scripts by hand
   from the project root, with no `.kaif/refresh-marker.json` present. Use the block of YOUR
   shell — a redirect or a `printf` that one shell understands is a parse error in another.

   POSIX shells (bash, zsh, sh — Git Bash on Windows too):

   ```sh
   node .kaif/hooks/prompt-refresh-timer.mjs < /dev/null
   printf '{"prompt":"resume\\nplan the day"}' | node .kaif/hooks/prompt-resume-word.mjs
   printf '{"prompt":"plan the day"}' | node .kaif/hooks/prompt-resume-word.mjs
   ```

   Windows PowerShell (5.1 and later):

   ```powershell
   '' | node .kaif/hooks/prompt-refresh-timer.mjs
   '{"prompt":"resume\nplan the day"}' | node .kaif/hooks/prompt-resume-word.mjs
   '{"prompt":"plan the day"}' | node .kaif/hooks/prompt-resume-word.mjs
   ```

   In either block the first line must print a JSON order (stamp a fresh marker and it must print
   nothing), the second must print the order to run `/resume`, the third must print nothing. The
   empty stdin on the first line matters: the hook reads its event JSON from stdin, so a hand-run
   without it waits on the terminal forever (field: a two-minute timeout on the first try). If
   the second line stays silent, the event did not parse — check that the JSON reached the script
   intact (the byte-order mark PowerShell puts in front of a piped string is dropped by the
   scripts themselves).

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
| **Meta Muse Code** | *(none yet)* | ❌ `PreCompact`/`PostCompact` exist, context-injection output not documented | ❌ prompt/LLM-call events exist, same injection gap | ❌ output contract of `Stop` not documented |
| **Windsurf / Cascade** | *(not supported)* | ❌ | ❌ | ❌ hooks cannot inject context at all — exit codes only |
| **Cline** | *(not supported)* | ❌ | ❌ | ❌ hooks are SDK plugins (TS/JS objects), not config-invoked commands |
| **Zoo Code** | *(markdown ritual)* | — | — | — no hook mechanism |

**The fifth hook — `pretool-owner-word.mjs` (2.8, epic OW) — is wired for Claude Code only** (`PreToolUse` in `settings-fragment.json`). It reads the
session transcript (`transcript_path`), which the vendor says «is written asynchronously and may lag»: one call may pass before a fresh
message is visible, one reminder may repeat right after an answer. The other systems' samples do not wire it — their transcript shape was
not read: **not verified**.

**The fourth hook — `prompt-resume-word.mjs` (2.7, epic RS) — is wired for Claude Code only.** It
needs the prompt TEXT in the event (`prompt`), and only the Claude Code contract was read to carry
it; the Codex, Cursor, Copilot and Antigravity samples do not wire it — whether their per-prompt
event carries the text was not read in the vendor documentation: **prompt field not verified**.
Wire it yourself only after reading that contract.

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

**Meta Muse Code** (beta since 2026-08-05) published its hook contract at
`dev.meta.ai/docs/muse-code/extending.md` (re-read live 2026-08-21): twelve lifecycle events
including `SessionStart`, `PreCompact`/`PostCompact` and `UserPromptSubmit`; project hooks live in
`<project-root>/.muse/hooks.json`, and project/user hooks must be explicitly trusted
(`muse hooks trust <key>`) before they run. Still no sample here, but the reason has changed:
the contract is now published, yet it documents no output field that injects context into the
agent — and injection is what all three hooks of this module do. The moment the vendor documents
an injection shape, Muse Code becomes a sample candidate; until then the markdown ritual is the
honest answer.

**Adding a system yourself:** read its live hook docs, find (1) the event that fires after context
is lost or per turn, and (2) the exact output field that injects context into the AGENT — not a
message to the human. If (2) does not exist, the system cannot carry this module, and the markdown
ritual is the honest answer, not a lesser one. If it does, add a shape to the `ENVELOPES` table in
the relevant script and a sample next to these.
