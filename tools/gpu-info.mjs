#!/usr/bin/env node
// tools/gpu-info.mjs — read-only probe of the GPU's tunable envelope.
//
// The first brick of KAGO's observation harness, and deliberately WRITE-FREE: it only asks the
// driver what it will allow. Every number KAGO's plans rest on (the power-limit floor above all)
// comes from here, so a future session can re-derive them instead of trusting a document.
//
// Usage:  npm run gpu:info  [--json]
// Exit:   0 = probed · 1 = nvidia-smi missing or no GPU
// [TESTED: 2026-08-09 · `npm run gpu:info` on the owner's RTX 5070 Ti → correct name, driver 610.88,
//  power range 250…300 W, exit 0]

import { spawnSync } from 'node:child_process';

const asJson = process.argv.includes('--json');

/** Run nvidia-smi and return trimmed stdout, or null if the call failed. */
function smi(args) {
  const r = spawnSync('nvidia-smi', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

// One CSV row of the fields that define what can be tuned and what the card costs to run.
const FIELDS = [
  'name', 'driver_version', 'vbios_version', 'pci.bus_id',
  'power.limit', 'power.default_limit', 'power.min_limit', 'power.max_limit',
  'clocks.max.graphics', 'clocks.current.graphics', 'temperature.gpu', 'pstate',
];

const row = smi(['--query-gpu=' + FIELDS.join(','), '--format=csv,noheader,nounits']);
if (row === null) {
  console.error('nvidia-smi is unavailable or reported no GPU — cannot probe.');
  process.exit(1);
}

const values = row.split(',').map((v) => v.trim());
const gpu = Object.fromEntries(FIELDS.map((f, i) => [f, values[i]]));

// The tuning headroom the driver exposes. This is the number that decided KAGO's architecture:
// a floor far above zero means power limiting alone cannot reach the master plan's targets.
const powerFloorSpan = Number(gpu['power.max_limit']) - Number(gpu['power.min_limit']);

if (asJson) {
  console.log(JSON.stringify({ ...gpu, powerFloorSpanW: powerFloorSpan }, null, 2));
} else {
  console.log(`GPU            ${gpu.name}`);
  console.log(`Driver / VBIOS ${gpu.driver_version} / ${gpu.vbios_version}`);
  console.log(`Bus id         ${gpu['pci.bus_id']}`);
  console.log(`Power limit    ${gpu['power.limit']} W (default ${gpu['power.default_limit']} W)`);
  console.log(`Power range    ${gpu['power.min_limit']} … ${gpu['power.max_limit']} W  → only ${powerFloorSpan} W of headroom`);
  console.log(`Graphics clock ${gpu['clocks.current.graphics']} MHz (max ${gpu['clocks.max.graphics']} MHz)`);
  console.log(`Temperature    ${gpu['temperature.gpu']} °C   Perf state ${gpu.pstate}`);
}
