#!/usr/bin/env node
// pretool-owner-word.mjs — the OWNER'S WORD MID-TURN gate (KAIF 2.8, epic OW; optional refresh-hooks module, deployed to .kaif/hooks/;
// origin bug 123 and its recurrence of 2026-09-25 19:32 — the origin owner asked for this hook the same evening; the owner's words are kept in the
// origin). Claude Code event: PreToolUse — the tool calls of the main thread.
//
// What it does: a message the owner typed while the agent was working is recorded in the session transcript as `type: "attachment"`,
// `attachment.type: "queued_command"`, `origin.kind: "human"`. If the LATEST such message has no assistant TEXT block after it and this gate
// has not refused for it yet, the tool call is BLOCKED (exit 2) ONCE and the reason — the owner's words and what to do — goes to the
// agent: answer as text, go on working, repeat the answer in the final text of the turn; the next call passes. The first edition
// refused EVERY call until a text answer showed in the record — and where the agent's texts between calls are recorded as reasoning,
// each mid-turn word stopped the work until the owner wrote again; the origin owner's verdict (2026-09-25 23:28 +03:00, rendered from
// Russian): answer by the hook and do not stop the work, keep working. An answer that stayed in the agent's
// reasoning is not delivered: the recurrence of 19:32 made 18 tool calls with the answer composed and never emitted as text.
// Silent on: a subagent's call (`agent_id` in the input — the main thread answers the owner), a peer's or a background message, the
// prompt that opened the turn (it is not a queued command), no transcript, any internal error (a hook never breaks the session).
// `KAIF_OWNER_WORD_GATE=off` in the environment switches it off.
//
// Contract (live-fetched 2026-09-25, https://code.claude.com/docs/en/hooks.md): «exit 2 … `PreToolUse` blocks the tool call»; the
// blocking message is the stderr text; the input carries `transcript_path`, which «is written asynchronously and may lag the in-memory
// conversation», and `agent_id` «present only when the hook fires inside a subagent call».
//
// @guard owner-word-mid-turn
// THREAT:         the owner writes while the agent works — «stop», a question, «switch to Y» — and the agent goes on calling tools without
//                 answering the owner in the chat (bug 123: session 67 worked past «stop»; recurrence 2026-09-25 19:32: 18 calls, the answer
//                 composed in the reasoning, never emitted)
// PROVED-AGAINST: s14 — synthetic transcripts in the recorded shapes: a human queued_command with no text after it → exit 2 with the
//                 owner's words; only reasoning and calls after it (the 19:32 shape) → 2; a text after it → 0; a peer → 0; a subagent
//                 call → 0; no transcript → 0; one refusal delivered → the next call passes; a refusal for an older message does not
//                 cover a newer one; red on v2.7 (no such hook); hooks-mutants M11 (reasoning counted as an answer), M12 (the refusal
//                 repeated forever — the stop the owner rejected)
// GAP:            the transcript lags — one call may pass before the message is visible (the next call is gated), one reminder may repeat
//                 right after an answer; a text that does NOT answer passes (the judge reads it — AGENT_GUIDE, the mid-turn rule); agent
//                 systems without a PreToolUse event; parallel calls of one message are refused together (one round); an answer
//                 written between calls may still land as reasoning — the order makes the final text of the turn carry it; a
//                 lagging refusal record may cost a second refusal
// ON-REAL-PATH:   2026-09-25 23:13–23:31 +03:00, the origin session — three mid-turn messages of the owner met live tool calls, each call
//                 refused with the owner's words, the answer given in the final text of the turn (the texts between calls were
//                 recorded as reasoning); the one-refusal edition — 2026-09-26 07:53–09:25 +03:00, the origin session: eight mid-turn
//                 messages of the owner; six met a gated call (one was not yet in the transcript — the GAP above — and one was covered
//                 by a newer message), seven calls refused in six rounds (one round of two parallel calls), the next call passed
//                 3.9–8.1 s after five rounds and 27.7 s after one (a refusal for the owner's next message came in between), no
//                 message refused twice — the work never stopped (court RL 2.8, B-F3; report
//                 testcases/reports/2026-09-26_rl2-remaining-seven-findings.md)
// [TESTED: 2026-09-25 23:35:16 +03:00 · the one-refusal edition: s14 106 green (+2: one refusal delivered → the next call passes; a refusal
//  for an older message does not cover a newer one), on dist v2.7 19 failures — exactly two new; hooks-mutants 12 of 12 (M12 red exactly on
//  «one refusal delivered», 23:35:38); on the REAL transcript after the refusals for the 23:33 message: exit 0 — report
//  testcases/reports/2026-09-25_ow11-page-scale-and-gate-once.md]
// [TESTED: 2026-09-25 22:07:30 +03:00 · s14: the eight cases green, on dist v2.7 red by name; hooks-mutants M11 red exactly on its three
//  addressees (22:08:57); run by hand on the REAL transcript of the origin session: exit 2 quoting the owner's unanswered mid-turn message at 22:05:33,
//  exit 0 at 22:19:26 once a text answer was in the record — report testcases/reports/2026-09-25_ow10-judge-fixes-owner-word-gate.md]
import { readFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';

const TAIL_BYTES = 4 * 1024 * 1024;  // the tail of the transcript that is read — a mid-turn message is recent by construction
const QUOTE_CHARS = 300;             // how much of the owner's message is quoted back to the agent

function readTail(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, n = Math.min(size, TAIL_BYTES), buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}
const GATE_MARK = 'KAIF: the owner wrote while you were working'; // the start of this gate's reason — how its own refusal is recognised
// a refusal of this gate as the transcript records it: a user record with an is_error tool_result whose text carries the mark
const refusedHere = (x) => !!x && x.type === 'user' && !!x.message && Array.isArray(x.message.content)
  && x.message.content.some((b) => b && b.type === 'tool_result' && b.is_error === true && flat(b.content).includes(GATE_MARK));
const flat = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join('') : v && typeof v === 'object' ? flat(v.text ?? v.content ?? '') : '');

try {
  if (String(process.env.KAIF_OWNER_WORD_GATE || '').toLowerCase() === 'off') process.exit(0);
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}'); } catch { process.exit(0); } // BOM: origin bug 119
  if (input.agent_id) process.exit(0);           // a subagent's call — the owner is answered by the main thread
  if (!input.transcript_path) process.exit(0);
  const recs = readTail(String(input.transcript_path)).split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } });
  let owner = -1, words = '', at = '';
  for (let i = recs.length - 1; i >= 0; i--) {  // the LATEST owner's message typed mid-turn
    const r = recs[i];
    if (!r || r.type !== 'attachment' || !r.attachment || r.attachment.type !== 'queued_command') continue;
    const who = (r.attachment.origin && r.attachment.origin.kind) || r.attachment.commandMode || '';
    if (who !== 'human') continue;
    owner = i; words = flat(r.attachment.prompt).replace(/\s+/g, ' ').trim(); at = r.timestamp || '';
    break;
  }
  if (owner < 0) process.exit(0);
  for (let k = owner + 1; k < recs.length; k++) { // answered = an assistant TEXT block after it (reasoning is not delivered)
    const x = recs[k];
    if (refusedHere(x)) process.exit(0); // ONE refusal per message was delivered — the work goes on (the origin owner's word, 2026-09-25)
    const c = x && x.type === 'assistant' && x.message && Array.isArray(x.message.content) ? x.message.content : [];
    if (c.some((b) => b.type === 'text' && String(b.text || '').trim())) process.exit(0);
  }
  process.stderr.write(GATE_MARK + (at ? ' (' + at + ')' : '') + ' and there is no TEXT answer after it yet: «'
    + words.slice(0, QUOTE_CHARS) + (words.length > QUOTE_CHARS ? '…' : '') + '». Answer it NOW AS TEXT in the chat, by its kind: a question →'
    + ' the answer; «stop» → stop in this turn and say where; «switch to Y» → a PARKED: line first, then Y; a note → record it. Then CONTINUE'
    + ' the work — this gate refuses only this one call for this message. A text between tool calls may be recorded as reasoning and never'
    + ' reach the chat: repeat the answer in the final text of the turn, which is delivered. (AGENT_GUIDE → «The owner\'s word mid-turn»;'
    + ' origin bug 123.)\n');
  process.exit(2);
} catch { process.exit(0); }
