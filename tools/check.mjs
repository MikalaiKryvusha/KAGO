#!/usr/bin/env node
// tools/check.mjs — KAGO's build gate.
//
// KAGO is plain Node.js ES modules: there is nothing to compile, bundle or transpile. What a build
// step would have caught — a file that is not valid JavaScript — is caught here instead, by parsing
// every .mjs in the tree without executing it. Cheap, deterministic, and it grows with the project.
//
// Usage:  npm run check        (this is <BUILD_COMMAND> for the framework's purposes)
// Exit:   0 = every file parses · 1 = at least one file failed to parse
// [TESTED: 2026-08-09 · `npm run check` → "checked 2 .mjs file(s), 0 failed", exit 0. The count was 3
//  before verify-final removed the installer's KAIF-LOADER.mjs from the root — the file count tracks
//  the tree, so re-read it rather than expecting this number.]

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

// Directories that hold no KAGO source: the framework's own machinery, deps, and VCS metadata.
const SKIP = new Set(['node_modules', '.git', '.kaif', '.claude', '.agents', '.grok', '.cline', '.roo']);

/** Walk the tree and collect every .mjs file that belongs to the project itself. */
function collect(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, found);
    else if (entry.endsWith('.mjs')) found.push(full);
  }
  return found;
}

const files = collect(ROOT);
let failed = 0;

for (const file of files) {
  // `node --check` parses the file and reports syntax errors without running a line of it.
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error('FAIL ' + relative(ROOT, file));
    if (r.stderr) console.error(r.stderr.trim());
  }
}

console.log(`checked ${files.length} .mjs file(s), ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
