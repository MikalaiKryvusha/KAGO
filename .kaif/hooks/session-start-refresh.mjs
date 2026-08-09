#!/usr/bin/env node
// session-start-refresh.mjs — the "canon after compaction" hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: SessionStart, matcher
// `compact|clear` (the sample config in .kaif/hooks/README.md wires exactly that).
//
// What it does: after a context compaction or /clear the session holds a RETELLING of the
// canon, not the canon — this hook injects an ORDER to re-read the re-read core and stamp the
// two-part refresh witness (AGENT_GUIDE.md → "Context refresh"). It injects the ORDER only,
// never document bodies: additionalContext is capped at 10 000 characters, and pasting docs
// would spend the very context the refresh is meant to restore.
//
// Predicate (anti-noise): none beyond the config matcher — compaction/clear is itself a rare
// event, so every firing is signal. Cooldown: the refresh marker; a session that obeys the
// order resets the timer hook's clock as a side effect.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `hook_event_name`, `source`, `cwd`;
// stdout on exit 0 — {"hookSpecificOutput": {"hookEventName": "SessionStart",
// "additionalContext": "…"}}. A hook must never break the session: any internal error → exit 0
// silently.
//
// PORTABILITY — `--emit <shape>` (epic O phase O5, contracts live-fetched 2026-08-07): the
// PREDICATE and the order text are identical everywhere; only the JSON envelope differs per
// agent system, so the shape is named EXPLICITLY by the sample config rather than guessed from
// stdin. A hook must exit silently on anything unclear, so a wrong guess would fail invisibly —
// an explicit flag fails loudly at review time instead. Shapes:
//   claude (default) — Claude Code AND OpenAI Codex: both read
//                      {"hookSpecificOutput": {"hookEventName": …, "additionalContext": …}}
//   cursor           — {"additional_context": …} (flat, snake_case; `sessionStart` only)
//   copilot          — {"additionalContext": …}  (flat, camelCase; `sessionStart` only)
// Systems whose session-start event cannot inject at all (Windsurf, Cline) get no sample: see
// .kaif/hooks/README.md. Unknown shape → treated as `claude`, never as silence.
// [TESTED: 2026-08-07 · polygon s14: stdin JSON piped in → stdout order names the re-read core, the marker and the quote; length under the cap]
import { readFileSync } from 'node:fs';

const OUTPUT_CAP = 10000; // Claude Code caps hook output strings at 10 000 characters

// One order string, four envelopes. Keeping this table next to the writer (rather than in a
// shared lib) keeps the module at three self-contained scripts — a fourth file would have to be
// registered through the whole delivery circle for six lines of JSON shaping.
const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
  cursor: (order) => ({ additional_context: order }),
  copilot: (order) => ({ additionalContext: order }),
};

try {
  const argv = process.argv.slice(2);
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let source = 'compact';
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (input.source) source = String(input.source);
  } catch { /* unreadable stdin — keep the default source label; the order still stands */ }

  // The trigger value the agent must stamp follows the ACTUAL event: a marker stamped
  // "compaction" after a /clear would misreport why the refresh happened.
  const trigger = source === 'clear' ? 'ritual:/clear' : 'compaction';
  const order =
    `KAIF context refresh (SessionStart:${source}). The context was just ${source === 'clear' ? 'cleared' : 'compacted'}: ` +
    `what this session now remembers of the canon is a retelling, not the canon. BEFORE task work: ` +
    `(1) re-read the re-read core (tier 1 of the document taxonomy — see AGENT_GUIDE.md → "Context refresh"); ` +
    `(2) stamp .kaif/refresh-marker.json { "at": "<ISO>", "docs": [...], "trigger": "${trigger}" }; ` +
    `(3) put the acceptance quote in the chat — one concrete line from what you re-read, relevant to the current task. ` +
    `A marker without the quote is fraud of the false-[TESTED] class (/fable-judge hunts it).`;

  // Unknown shape falls back to the reference envelope: printing SOMETHING the reference system
  // understands beats printing nothing, and a typo in a sample config stays visible.
  const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'SessionStart');
  if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
