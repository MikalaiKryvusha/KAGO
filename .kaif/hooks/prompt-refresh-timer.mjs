#!/usr/bin/env node
// prompt-refresh-timer.mjs — the hourly refresh timer hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: UserPromptSubmit.
//
// What it does: mechanizes trigger 1 of the refresh canon ("refresh at least once an hour" —
// AGENT_GUIDE.md → "Context refresh"). On every prompt it reads the AGE of the refresh witness
// `.kaif/refresh-marker.json`; if the last refresh is older than the interval (or the marker is
// missing — this session never refreshed), it injects an ORDER to refresh before starting the
// work. A fresh marker → no output at all: silence is the normal state.
//
// Predicate (anti-noise): marker age > REFRESH_INTERVAL_MIN. Cooldown: the marker itself —
// only the FACT of a refresh (agent re-stamps the marker) resets the clock, so the order
// repeats on every prompt until obeyed, by design: a reminder that goes away unobeyed teaches
// that it can be ignored.
//
// Interval: 60 minutes (the canon's "at least once an hour"); override per project with
// `--minutes N` in the hook's args if the owner wants a different cadence.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `hook_event_name`, `cwd`; stdout on
// exit 0 — {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext":
// "…"}}. A hook must never break the session: any internal error → exit 0 silently.
// [TESTED: 2026-08-07 · polygon s14: fresh marker → silent; missing marker → order ("no refresh
//  witness"); marker older than the interval → order naming the age; MALFORMED marker → judged by
//  the file's mtime instead, so malformed+fresh is SILENT and malformed+old speaks]
//
// PORTABILITY — `--emit <shape>` (epic O phase O5, contracts live-fetched 2026-08-07). The
// timer is the hook systems disagree about MOST: only two of the surveyed systems let a
// per-turn hook inject context at all.
//   claude (default) — Claude Code AND OpenAI Codex (identical field names, `UserPromptSubmit`)
//   antigravity      — Google Antigravity CLI, event `PreInvocation` (fires before each model
//                      call): {"injectSteps": [{"ephemeralMessage": "…"}]} — the array holds
//                      objects, and `ephemeralMessage` is the right member for an order that
//                      must steer this turn without settling into the transcript.
// Cursor (`beforeSubmitPrompt` → only `continue`/`user_message`) and GitHub Copilot
// (`additionalContext` is not permitted on `userPromptSubmitted`) cannot carry this hook at
// all — they ship the session-start hook only, and .kaif/hooks/README.md says so per system.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_CAP = 10000;           // Claude Code caps hook output strings at 10 000 characters
const DEFAULT_INTERVAL_MIN = 60;    // the canon's "refresh at least once an hour"
const MARKER = '.kaif/refresh-marker.json';

// Same order, different envelope per system — see the PORTABILITY note above.
const ENVELOPES = {
  claude: (order, event) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: order } }),
  antigravity: (order) => ({ injectSteps: [{ ephemeralMessage: order }] }),
};

try {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--minutes');
  const intervalMin = mi !== -1 && Number(argv[mi + 1]) > 0 ? Number(argv[mi + 1]) : DEFAULT_INTERVAL_MIN;
  const ei = argv.indexOf('--emit');
  const shape = ei !== -1 ? String(argv[ei + 1]) : 'claude';

  let cwd = process.cwd();
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (input.cwd) cwd = String(input.cwd);
  } catch { /* unreadable stdin — fall back to process.cwd() */ }

  const markerPath = join(cwd, MARKER);
  // Age of the last refresh: the marker's own `at` field is the truth; a malformed field falls
  // back to the file mtime; a missing file means "never refreshed" → infinitely stale.
  let ageMin = Infinity;
  try {
    let at = NaN;
    try { at = Date.parse(JSON.parse(readFileSync(markerPath, 'utf8')).at); } catch { /* malformed JSON/at */ }
    if (Number.isNaN(at)) at = statSync(markerPath).mtimeMs;
    ageMin = (Date.now() - at) / 60000;
  } catch { /* no marker at all — stays Infinity */ }

  if (ageMin > intervalMin) {
    const ageLabel = ageMin === Infinity ? 'no refresh witness found this session' : `last refresh ${Math.round(ageMin)} min ago`;
    const order =
      `KAIF context refresh (timer: ${ageLabel}, interval ${intervalMin} min). Before starting on this prompt: ` +
      `re-read the re-read core (AGENT_GUIDE.md → "Context refresh"), re-stamp .kaif/refresh-marker.json ` +
      `{ "at": "<ISO>", "docs": [...], "trigger": "hour" } and put the acceptance quote in the chat — one concrete ` +
      `line from what you re-read, relevant to the task. This reminder repeats until the marker is actually refreshed.`;
    // Unknown shape → reference envelope (see session-start-refresh.mjs for the reasoning).
    const payload = (ENVELOPES[shape] || ENVELOPES.claude)(order, 'UserPromptSubmit');
    if (order.length <= OUTPUT_CAP) process.stdout.write(JSON.stringify(payload));
  }
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
