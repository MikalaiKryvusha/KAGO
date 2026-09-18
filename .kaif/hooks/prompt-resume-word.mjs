#!/usr/bin/env node
// prompt-resume-word.mjs — the "leading word is an order" hook (KAIF 2.7, epic RS; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: UserPromptSubmit.
//
// What it does: mechanizes the canon rule "A leading skill word is an order" (AGENT_GUIDE.md →
// next to "The form of an obligation"). The owner opens a chat with the bare word `resume` (or
// its Russian shorthand, "rezyum…") and writes the task below it; a session that reads the word as
// a TOPIC starts the task and skips the entry ritual — it then works without the canon, the
// owner's queue, the creed and the prayer. This hook reads the FIRST WORD of the prompt and, when
// it is the resume word, injects an ORDER: run /resume in full BEFORE any work on the rest of the
// message. Any other message → no output at all: silence is the normal state.
//
// Predicate (anti-noise): the prompt's first word is `/resume`, `resume` or the Russian shorthand
// "rezyum…" (any case; leading whitespace tolerated). The word ANYWHERE ELSE in the message is prose — the kick's
// boundary ("a command word mid-sentence is not a command", /kaif-go) holds unchanged, and the hook
// never fires on it. No cooldown: every message that opens with the word is a separate order (the
// owner writes it once per chat by design). No `prompt` field in the event → silent: a predicate
// over text cannot be guessed without the text, and a guess would fire on every prompt.
//
// Field origin (the origin's owner, 2026-09-18, rendered from Russian): "when I start a chat and
// just write the word resume at the top and below it what we do, agents often do not run the
// resume skill — and that is exactly why I write it there. If I write it, I REQUIRE the agent to
// run that skill before starting the work."
//
// Contract (Claude Code — the sibling hooks' contract was live-fetched 2026-08-07; the
// UserPromptSubmit event carries the user's message text in `prompt`): stdin — JSON with
// `hook_event_name`, `cwd`, `prompt`; stdout on exit 0 — {"hookSpecificOutput": {"hookEventName":
// "UserPromptSubmit", "additionalContext": "…"}}. A hook must never break the session: any
// internal error → exit 0 silently.
// [TESTED: 2026-09-18 08:12 +03:00 - FUNCTIONAL run on the owner's real path: the owner opened a new
//  chat of the origin with "resume" + newline + "continue" (in Russian), this hook wired in
//  .claude/settings.json; the injected order stood in the session context, was quoted in the chat
//  verbatim BEFORE the refresh marker was stamped, and /resume ran in full; report -
//  testcases/reports/2026-09-18_hook-resume-word.md, run 17, verdict pass. Hygiene beside it: polygon s14
//  6/6 ("resume" + newline + task, the Cyrillic shorthand with a period, "/resume" -> the order; no word,
//  the word mid-sentence, no `prompt` field -> silence), the 2.6 core (KAIF_DIST) 8 asserts red, a mutant
//  bundle with the predicate broken exactly the 3 order asserts red - hygiene alone never flipped this
//  marker (TESTING_FRAMEWORK.md, hygiene is not a test)]
//
// PORTABILITY — `--emit <shape>`: `claude` only. OpenAI Codex reads the same output fields on
// UserPromptSubmit, but whether ITS event carries the prompt text was not read in its live
// documentation — so no Codex sample wires this hook (README table: "prompt field not verified").
// A wrong guess would fail invisibly; an explicit gap stays visible.
import { readFileSync } from 'node:fs';

const OUTPUT_CAP = 10000; // Claude Code caps hook output strings at 10 000 characters

// The leading word: optional slash, then `resume` (English — the owner's word under every language
// pack) or the Russian shorthand family ("rezyum", "rezyume", "rezyumiruy" — spelled here as Unicode
// escapes: the EN payload body carries no Cyrillic by invariant, bug 31 of the origin), then NOT a
// letter, digit or underscore (a Unicode-aware boundary — `\b` is ASCII-only and would fail after a
// Cyrillic letter). Only the FIRST word of the message counts. Boundary named on purpose: a message
// opening with a file named `resume.log` also fires — one extra entry ritual costs less than one
// skipped ritual.
const LEADING_RESUME = /^\s*\/?(?:resume|\u0440\u0435\u0437\u044e\u043c[\u0430-\u044f\u0451]*)(?![\p{L}\p{N}_])/iu;

const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
};

try {
  const argv = process.argv.slice(2);
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let prompt = null;
  try {
    // A leading U+FEFF is dropped before the parse: Windows PowerShell 5.1 on a UTF-8 console puts
    // the three bytes in front of ANY string piped into a native command, so the hand-run smoke of
    // .kaif/hooks/README.md fell silent on a valid event (origin bugs 119/121). RFC 8259 §8.1: a
    // parser "MAY ignore the presence of a byte order mark rather than treating it as an error".
    const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}');
    if (typeof input.prompt === 'string') prompt = input.prompt;
  } catch { /* unreadable stdin — no text, no predicate, no output */ }

  if (prompt !== null && LEADING_RESUME.test(prompt)) {
    const order =
      `KAIF: the owner's message OPENS with the word "resume" — that is an ORDER, not a topic ` +
      `(AGENT_GUIDE.md → "A leading skill word is an order"; the owner's word: "if I write it, I REQUIRE ` +
      `the skill to run before the work"). BEFORE any work on the rest of this message run the /resume ` +
      `skill IN FULL: (1) read every canon document of its step 1 — the full set, not a slice; (2) run the ` +
      `owner's queue (step 1b) and raise what was never shown; (3) say the creed and the prayer aloud; ` +
      `(4) announce in one paragraph what you read, what you chose and what you do next; (5) stamp ` +
      `.kaif/refresh-marker.json with trigger "ritual:/resume" and put the acceptance quote in the chat. ` +
      `Only then take the task written under the word. The same word mid-sentence would be prose; at the ` +
      `top of the message it is this order.`;
    // Unknown shape → reference envelope (see session-start-refresh.mjs for the reasoning).
    const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'UserPromptSubmit');
    if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
  }
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
