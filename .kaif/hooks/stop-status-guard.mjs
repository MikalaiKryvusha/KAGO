#!/usr/bin/env node
// stop-status-guard.mjs — the STATUS freshness guard hook (KAIF 2.2, epic O; optional
// refresh-hooks module, deployed to .kaif/hooks/). Claude Code event: Stop. The ONLY blocking
// hook of the module — and even it blocks softly: once per session, with a reason that asks
// for an update or an explicit "nothing changed", never a hard wall.
//
// What it does: STATUS.md is the baton between sessions — a session that changed the tree but
// never touched STATUS hands the next session a stale summary. When the agent is about to
// finish its turn, this hook checks: did this session do work (dirty worktree or a recent
// commit) while STATUS.md stayed untouched longer than the staleness window? If yes — one soft
// block with the reminder.
//
// Predicate (anti-noise): (dirty git worktree OR last commit within STALE_HOURS) AND
// STATUS.md mtime older than STALE_HOURS. Cooldown: once per session — a state file keyed by
// session_id in the OS temp dir (ephemeral session state; never pollutes the project tree).
// No git / no STATUS.md → silent: the guard never reddens a project it does not understand.
//
// Contract (live-fetched 2026-08-07): stdin — JSON with `session_id`, `cwd`; blocking output —
// top-level {"decision": "block", "reason": "…"}. A hook must never break the session: any
// internal error → exit 0 silently.
// [TESTED: 2026-08-07 · polygon s14: dirty tree + old STATUS → block JSON once; same session again → silent (cooldown); fresh STATUS → silent; no git → silent]
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const STALE_HOURS = 3;        // STATUS older than this while work happened → remind
const STATUS_FILE = 'STATUS.md';

try {
  let cwd = process.cwd();
  let sessionId = 'unknown-session';
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (input.cwd) cwd = String(input.cwd);
    if (input.session_id) sessionId = String(input.session_id);
  } catch { /* unreadable stdin — defaults keep the guard functional */ }

  // Cooldown: one reminder per session. The state file lives in the OS temp dir — session
  // state never pollutes the project tree (the refresh marker earned its .gitignore line;
  // this one does not even need that).
  const cooldownPath = join(tmpdir(), `kaif-status-guard-${sessionId.replace(/[^\w.-]/g, '_')}`);
  if (existsSync(cooldownPath)) process.exit(0);

  const statusPath = join(cwd, STATUS_FILE);
  if (!existsSync(statusPath)) process.exit(0);   // no STATUS.md — nothing to guard
  const statusAgeH = (Date.now() - statSync(statusPath).mtimeMs) / 3600000;
  if (statusAgeH <= STALE_HOURS) process.exit(0); // STATUS is fresh — silence is the normal state

  // Did this session actually do work? Dirty worktree or a commit within the window.
  // Any git failure (not a repo, git missing) → silent: never redden what we cannot observe.
  const git = (args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let workHappened = false;
  try {
    if (git(['status', '--porcelain'])) workHappened = true;
    else {
      const lastCommitSec = Number(git(['log', '-1', '--format=%ct']));
      if (lastCommitSec && (Date.now() / 1000 - lastCommitSec) / 3600 < STALE_HOURS) workHappened = true;
    }
  } catch { process.exit(0); }
  if (!workHappened) process.exit(0);

  writeFileSync(cooldownPath, new Date().toISOString());
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `KAIF STATUS guard (fires once per session): this session changed the tree, but ${STATUS_FILE} was last ` +
      `touched ~${Math.round(statusAgeH)} h ago. Update ${STATUS_FILE} with the current state — or state explicitly ` +
      `in the chat why nothing in it changed — then finish.`,
  }));
} catch { /* a hook must never take the session down with it */ }
process.exit(0);
