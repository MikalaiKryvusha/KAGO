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
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

/**
 * ВСЯ РАБОТА ПРИБОРА — здесь, и зовётся она ТОЛЬКО при прямом запуске (`bugs/95`, сессия 78).
 * До починки тело стояло на верхнем уровне модуля и исполнялось при ИМПОРТЕ с argv вызывающего.
 * Тело намеренно НЕ сдвинуто по отступу: в приборах этого класса есть многострочные шаблоны,
 * и сдвиг изменил бы порождаемые артефакты; голден байт-в-байт дороже отступа.
 * @param {string[]} argv аргументы БЕЗ `node` и пути к файлу
 */
async function main(argv) {

const asJson = argv.includes('--json');

/** Run nvidia-smi and return trimmed stdout, or null if the call failed. */
function smi(args) {
  const r = spawnSync('nvidia-smi', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

/**
 * The supported-clock ladder — PHASE 5'S SEARCH SPACE (plan §3.8).
 *
 * The driver publishes, for each memory clock it will run, the exact graphics clocks it will accept.
 * That list is not decoration: it is the set of points a Vmin sweep is allowed to stand on, and
 * inventing a frequency outside it would be a request the driver silently rounds or refuses.
 *
 * SORTED ASCENDING, both levels (`AGENT_GUIDE.md` → canonical order): this output is diffed against
 * itself across driver versions, and an unsorted list would show phantom changes.
 *
 * THE STEP IS MEASURED, NOT ASSUMED. `step_mhz` reports the distinct gaps actually observed with
 * their counts, rather than one averaged number — on this card the gap alternates 7 and 8 MHz, and
 * an "average 7.5" would be a figure the ladder never contains. Note this is the CLOCK grid; the
 * VOLTAGE grid stays unmeasured until phase 4 (`config.VOLTAGE_GRID_STEP_IS_MEASURED === false`),
 * and the two must not be confused.
 *
 * [TESTED: 2026-08-10 · parsed on this card: 5 memory clocks, 1651 graphics entries in all, 389 per
 * full rung, 180…3090 MHz, gaps {7: 194, 8: 194} on the measured rung. The top entry 3090 MHz matches
 * `clocks.max.graphics` from the CSV probe above AND the figure recorded in researches/01 §2 — three
 * independent readings, one number. `ladder_identical_on_full_rungs` mutation-proved: shifting one
 * rung by 1 MHz flipped it to DIFFERS]
 */
function parseSupportedClocks(text) {
  if (text === null) return { available: false, why: 'nvidia-smi не ответил на -q -d SUPPORTED_CLOCKS' };

  // One owner, one machine — but a silent merge of two cards' ladders would be a fabricated search
  // space, so a second GPU stops the parse instead of blending into the first.
  const gpuHeaders = text.split('\n').filter((l) => /^GPU\s+\S+/u.test(l));
  if (gpuHeaders.length > 1) {
    return { available: false, why: `в выводе ${gpuHeaders.length} карт — лестница у каждой своя, разбор остановлен` };
  }

  const byMemory = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const mem = line.match(/^\s+Memory\s*:\s*(\d+)\s*MHz\s*$/u);
    if (mem) { current = Number(mem[1]); if (!byMemory.has(current)) byMemory.set(current, []); continue; }
    const gfx = line.match(/^\s+Graphics\s*:\s*(\d+)\s*MHz\s*$/u);
    if (gfx && current !== null) byMemory.get(current).push(Number(gfx[1]));
  }
  if (!byMemory.size) return { available: false, why: 'блок Supported Clocks не найден или пуст' };

  const memory_clocks_mhz = [...byMemory.keys()].sort((a, b) => a - b);
  const graphics_by_memory_mhz = {};
  for (const m of memory_clocks_mhz) {
    graphics_by_memory_mhz[m] = [...new Set(byMemory.get(m))].sort((a, b) => a - b);
  }

  // The step, measured on the richest ladder rather than on whichever came first.
  const richest = memory_clocks_mhz.reduce((best, m) =>
    (graphics_by_memory_mhz[m].length > graphics_by_memory_mhz[best].length ? m : best), memory_clocks_mhz[0]);
  const ladder = graphics_by_memory_mhz[richest];
  const gaps = {};
  for (let i = 1; i < ladder.length; i++) {
    const d = ladder[i] - ladder[i - 1];
    gaps[d] = (gaps[d] || 0) + 1;
  }

  // Is the search space the SAME whichever memory rung you stand on? On this card it is — every full
  // rung offers the identical 180…3090 ladder — and that is worth recording rather than implying by
  // sampling one rung: phase 5 may then sweep the graphics clock without re-deriving the space for
  // each memory setting. Computed, never assumed, so a card where it is false says so.
  const fingerprint = (m) => graphics_by_memory_mhz[m].join(',');
  const fullRungs = memory_clocks_mhz.filter((m) => graphics_by_memory_mhz[m].length === graphics_by_memory_mhz[richest].length);
  const uniform = fullRungs.length > 1 && fullRungs.every((m) => fingerprint(m) === fingerprint(richest));

  const all = Object.values(graphics_by_memory_mhz).flat();
  return {
    available: true,
    memory_clocks_mhz,
    graphics_by_memory_mhz,
    graphics_min_mhz: Math.min(...all),
    graphics_max_mhz: Math.max(...all),
    graphics_points_total: all.length,
    graphics_points_per_full_rung: graphics_by_memory_mhz[richest].length,
    ladder_identical_on_full_rungs: uniform,
    full_rungs_memory_mhz: fullRungs,
    step_measured_on_memory_mhz: richest,
    step_mhz: Object.fromEntries(Object.keys(gaps).sort((a, b) => Number(a) - Number(b)).map((k) => [k, gaps[k]])),
  };
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

const supportedClocks = parseSupportedClocks(smi(['-q', '-d', 'SUPPORTED_CLOCKS']));

if (asJson) {
  console.log(JSON.stringify({ ...gpu, powerFloorSpanW: powerFloorSpan, supported_clocks: supportedClocks }, null, 2));
} else {
  console.log(`GPU            ${gpu.name}`);
  console.log(`Driver / VBIOS ${gpu.driver_version} / ${gpu.vbios_version}`);
  console.log(`Bus id         ${gpu['pci.bus_id']}`);
  console.log(`Power limit    ${gpu['power.limit']} W (default ${gpu['power.default_limit']} W)`);
  console.log(`Power range    ${gpu['power.min_limit']} … ${gpu['power.max_limit']} W  → only ${powerFloorSpan} W of headroom`);
  console.log(`Graphics clock ${gpu['clocks.current.graphics']} MHz (max ${gpu['clocks.max.graphics']} MHz)`);
  console.log(`Temperature    ${gpu['temperature.gpu']} °C   Perf state ${gpu.pstate}`);

  // The ladder is printed as a SUMMARY: 1651 lines of frequencies would bury everything above them.
  // The full list is in --json, which is what phase 5 reads.
  if (!supportedClocks.available) {
    console.log(`Clock ladder   недоступна: ${supportedClocks.why}`);
  } else {
    const steps = Object.entries(supportedClocks.step_mhz).map(([mhz, n]) => `${mhz} MHz ×${n}`).join(', ');
    console.log(`Memory clocks  ${supportedClocks.memory_clocks_mhz.join(', ')} MHz`);
    console.log(`Clock ladder   ${supportedClocks.graphics_points_total} points total, ` +
      `${supportedClocks.graphics_points_per_full_rung} per full rung, ` +
      `${supportedClocks.graphics_min_mhz} … ${supportedClocks.graphics_max_mhz} MHz  (phase 5's search space)`);
    console.log(`               ${supportedClocks.ladder_identical_on_full_rungs
      ? `identical on all ${supportedClocks.full_rungs_memory_mhz.length} full memory rungs — sweep the graphics clock once`
      : 'DIFFERS between memory rungs — the search space must be re-derived per memory clock'}`);
    console.log(`Ladder step    ${steps} — measured on the ${supportedClocks.step_measured_on_memory_mhz} MHz memory rung.`);
    console.log(`               This is the CLOCK grid. The VOLTAGE grid is still unmeasured (phase 4).`);
  }
}
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
