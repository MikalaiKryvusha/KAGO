// Prove the error gradient MEASURES, by building a deliberately corrupted copy of sdc_fma.cu and
// checking the reported numbers against exactly-known expected values.
//
// The injection flips ONE bit of ONE element on launch #5 — the lowest mantissa bit of element 123.
// So the expected report is not "something non-zero" but an exact tuple:
//     distinct=2 · bad_launches=1 · bad_elems_max=1 · bit_dist_min=1 · first_bad_index=123
// A gradient that cannot produce those five numbers is not measuring what it claims to measure.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findToolchain, buildCuda } from '../automation-engine/lib/toolchain.mjs';

const REPO = 'D:\\work\\ai_sandbox\\KAGO';
const OUT = path.join(process.env.TEMP || process.env.TMP || '.', 'kago-gradient-proof');
mkdirSync(OUT, { recursive: true });

const src = readFileSync(path.join(REPO, 'workloads', 'sdc_fma.cu'), 'utf8');

const ANCHOR = '        cudaMemcpy(h, d, n * sizeof(float), cudaMemcpyDeviceToHost);';
if (!src.includes(ANCHOR)) { console.log('SKIP: anchor not found'); process.exit(1); }

const INJECT = ANCHOR + `
        // INJECTED CORRUPTION (test copy only): flip the lowest mantissa bit of element 123 on
        // launch #5, so the gradient has an exactly-known thing to measure.
        if (launches == 5) { uint32_t *p_ = (uint32_t *)h; p_[123] ^= 1u; }`;

const mutated = src.replace(ANCHOR, INJECT);
const cuPath = path.join(OUT, 'sdc_fma_corrupt.cu');
writeFileSync(cuPath, mutated, 'utf8');

const tc = findToolchain();
const exePath = path.join(OUT, 'sdc_fma_corrupt.exe');
const built = buildCuda(cuPath, exePath, { toolchain: tc });
if (!built.ok) {
  console.log('BUILD FAILED');
  console.log(String(built.stderr || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

const r = spawnSync(exePath, ['--sustain', '2'], { encoding: 'utf8' });
const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('KAGO-WORKLOAD')) || '';
console.log(line);

const f = {};
for (const part of line.split(/\s+/).slice(1)) {
  const eq = part.indexOf('=');
  if (eq > 0) f[part.slice(0, eq)] = part.slice(eq + 1);
}

const expected = { distinct: '2', bad_launches: '1', bad_elems_max: '1', bit_dist_min: '1', first_bad_index: '123' };
let bad = 0;
for (const [k, v] of Object.entries(expected)) {
  const ok = f[k] === v;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'ПРОВАЛ'} ${k}: ждали ${v}, получено ${f[k]}`);
}
console.log('');
console.log(bad === 0
  ? 'ГРАДИЕНТ ИЗМЕРЯЕТ: одиночный переворот бита опознан как 1 элемент, расстояние 1, индекс 123.'
  : `ГРАДИЕНТ НЕ ИЗМЕРЯЕТ: расхождений ${bad}.`);
process.exit(bad === 0 ? 0 : 1);
