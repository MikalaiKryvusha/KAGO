// tools/cmp-chain.mjs — the honest stock comparison of the four modes, in one detached process (session 112, 2026-10-17).
// WRITES TO THE GPU through the owner's shortcuts (the same path as his double-click: explorer.exe <.lnk> → \KAGO\apply-*).
// Per mode: [5 min idle so the attics air out] → shortcut → settle → two state reads → Q2RTX capture, 60 passes to the
// thermal plateau → plateau analyze. Order: stock → max → silent → opt. The card ends on the LAST mode of the list
// (by default ⚖️ Optimised, the remembered boot mode). Log: runs/graphics/cmp2-chain.log, append-only, fsync per line.
//
// Run it DETACHED — a capture lasts 12–14 min, longer than the agent's 10-min background-task ceiling:
//   PowerShell: $env:AIR_FIRST='1'; Start-Process node -ArgumentList 'tools/cmp-chain.mjs' -WindowStyle Hidden
//   only some modes:  node tools/cmp-chain.mjs max silent opt
// Then the table: node automation-engine/lib/mode-validate.mjs --compare --stock runs/graphics/cmp2-stock.json --mode runs/graphics/cmp2-<m>.json
// The machine is shared with KUMM: the lock is taken here (80 min) and released in `finally`.
// The end-of-turn tidy leaves the capture's sampler alone since bugs/152 (marker + same-snapshot check).
// [TESTED: 2026-10-17 22:02–23:19 · this exact flow produced cmp2-{stock,max,silent,opt}; report
//  testcases/reports/2026-10-17_cmp2_stock_comparison.md]
import { spawnSync } from 'node:child_process';
import { openSync, writeSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(REPO, 'runs/graphics/cmp2-chain.log');
const DESK = 'C:/Users/krinik/Desktop';
const LOCK = 'D:/work/ai_sandbox/_tools/machine-lock.mjs';
const AIR_S = 300;      // the owner's word 17.10: «давать 5 минут проветриться антресоли после прошлого прогона»
const SETTLE_S = 20;    // the apply task re-reads until stable; 20 s covers it with room
const MODES = [
  { key: 'stock', profile: 'stock-default', lnk: '\u{1F504} Stock Default.lnk' },
  { key: 'max', profile: 'max-performance', lnk: '\u{1F680} Max Perfomance.lnk' },
  { key: 'silent', profile: 'silent-cold', lnk: '\u2744\uFE0F Silent Cold.lnk' },
  { key: 'opt', profile: 'optimised', lnk: '\u2696\uFE0F Optimised.lnk' },
];

function log(s) {
  const fd = openSync(LOG, 'a'); writeSync(fd, `${new Date().toISOString()} ${s}\n`); fsyncSync(fd); closeSync(fd);
}
function node(args, timeoutMs = 120000) {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const sleep = (s) => new Promise((res) => setTimeout(res, s * 1000));
const lock = (cmd, extra = []) => node([LOCK, cmd, '--who', 'kago', ...extra]);

async function main(argv) {
  const modes = argv.length ? MODES.filter((m) => argv.includes(m.key)) : MODES;
  log(`START chain: ${modes.map((m) => m.key).join(' -> ')}`);
  const t = lock('take', ['--what', 'cmp2 stock comparison (Q2RTX plateau)', '--minutes', '80']);
  log(`LOCK take exit=${t.code} ${t.out.trim().split('\n').pop()}`);
  if (t.code !== 0) { log('ABORT: lock not taken'); return 3; }
  try {
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      if (i > 0 || process.env.AIR_FIRST) { log(`AIR ${AIR_S}s before ${m.key}`); await sleep(AIR_S); }
      const lnk = join(DESK, m.lnk);
      if (!existsSync(lnk)) { log(`ABORT: shortcut missing ${m.key}`); return 4; }
      spawnSync('explorer.exe', [lnk]);
      log(`SHORTCUT ${m.key} launched; settle ${SETTLE_S}s`);
      await sleep(SETTLE_S);
      for (const n of [1, 2]) {
        const pick = (o) => o.split('\n').filter((l) => /сдвиг|мощност|лимит|частот|power|limit|clock/i.test(l)).slice(0, 6).join(' | ');
        log(`READ${n} ${m.key} probe-offer :: ${pick(node(['tools/probe-offer.mjs']).out)}`);
        log(`READ${n} ${m.key} state :: ${pick(node(['automation-engine/lib/profile-manager.mjs', '--state']).out)}`);
        if (n === 1) await sleep(3);
      }
      log(`CAPTURE ${m.key} begin`);
      const c = node(['automation-engine/lib/graphics-load.mjs', '--capture', '--label', `cmp2-${m.key}`, '--profile', m.profile, '--runs', '60'], 30 * 60 * 1000);
      log(`CAPTURE ${m.key} exit=${c.code} :: ${c.out.trim().split('\n').slice(-8).join(' | ')}`);
      const a = node(['automation-engine/lib/thermal-ladder.mjs', '--analyze', `cmp2-${m.key}`]);
      log(`PLATEAU ${m.key} :: ${a.out.trim().split('\n').filter((l) => l.includes('cmp2-')).join(' | ')}`);
      log(`DONE ${m.key}`);
    }
  } finally {
    log(`LOCK release exit=${lock('release').code}`);
    log('END chain');
  }
  return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.includes('--help')) { console.log('node tools/cmp-chain.mjs [stock] [max] [silent] [opt] — сравнение режимов со стоком на Q2RTX до плато; ПИШЕТ В КАРТУ через ярлыки; env AIR_FIRST=1 — 5 мин простоя и перед первым'); process.exit(0); }
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { log(`CRASH ${e && e.stack}`); process.exit(1); });
}
