// Prove the error gradient MEASURES, by building a deliberately corrupted copy of a workload and
// checking the reported numbers against exactly-known expected values.
//
// WHICH WORKLOAD: `--workload <name>` (default sdc_fma). The prover is workload-agnostic because
// the graded oracle now lives in more than one kernel, and a proof that only ever ran against the
// original would let the new one ship unproved — the exact shape of a false [TESTED].
// Every workload it can prove must expose the same five fields and take `--sustain`.
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

const argv = process.argv.slice(2);
const wIdx = argv.indexOf('--workload');
const NAME = wIdx >= 0 && argv[wIdx + 1] ? argv[wIdx + 1] : 'sdc_fma';
const src = readFileSync(path.join(REPO, 'workloads', `${NAME}.cu`), 'utf8');

// The injection point is "right after the results land on the host, before they are hashed". Each
// workload spells that copy slightly differently, so the anchor is looked up per workload rather
// than assumed — an anchor that silently fails to match would build a CLEAN binary and report a
// passing proof of nothing.
const ANCHORS = {
  sdc_fma: '        cudaMemcpy(h, d, n * sizeof(float), cudaMemcpyDeviceToHost);',
  furnace: '        CUDA_OK(cudaMemcpy(h, d_out, n * sizeof(float), cudaMemcpyDeviceToHost));',
};
const ANCHOR = ANCHORS[NAME];
if (!ANCHOR) { console.log(`ОСТАНОВ: для нагрузки ${NAME} не назван якорь впрыска`); process.exit(1); }
if (!src.includes(ANCHOR)) { console.log(`ОСТАНОВ: якорь впрыска не найден в ${NAME}.cu`); process.exit(1); }

const INJECT = ANCHOR + `
        // INJECTED CORRUPTION (test copy only): flip the lowest mantissa bit of element 123 on
        // launch #5, so the gradient has an exactly-known thing to measure.
        if (launches == 5) { uint32_t *p_ = (uint32_t *)h; p_[123] ^= 1u; }`;

const mutated = src.replace(ANCHOR, INJECT);
const cuPath = path.join(OUT, `${NAME}_corrupt.cu`);
writeFileSync(cuPath, mutated, 'utf8');

const tc = findToolchain();
const exePath = path.join(OUT, `${NAME}_corrupt.exe`);
const built = buildCuda(cuPath, exePath, { toolchain: tc });
if (!built.ok) {
  console.log('BUILD FAILED');
  console.log(String(built.stderr || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// Sustain long enough that launch #5 actually happens: furnace's launches are ~370 ms, so two
// seconds would end the run at launch #5 or before and the injection would never fire.
const SUSTAIN = NAME === 'furnace' ? '8' : '2';
const r = spawnSync(exePath, ['--sustain', SUSTAIN], { encoding: 'utf8' });
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
