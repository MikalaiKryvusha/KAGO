#!/usr/bin/env node
// tools/mem-latency.mjs — задержка оперативной памяти методом pointer chase (случайный цикл по массиву больше кэша).
// Зачем: замер «до/после» разгона памяти CPU (сессия 114, 08.11.2026). Абсолютное число включает накладные JS (~1 нс),
// сравнивать только прогоны этого же скрипта на этой же машине. Только чтение, ничего не пишет кроме stdout.
//   node tools/mem-latency.mjs [--mb 512] [--runs 5]
import { pathToFileURL } from 'node:url';

/** Замер; argv — аргументы после имени скрипта. Чистый вход: ничего не делает при импорте (сторож входа, bugs/95). */
export function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const MB = arg('--mb', 512), RUNS = arg('--runs', 5);
  const N = (MB * 1024 * 1024) / 4;            // элементов Uint32
  const next = new Uint32Array(N);
  // Случайная перестановка Саттоло — один цикл через все элементы, предсказатель не угадает шаг.
  const STRIDE = 16;                            // по одному элементу на кэш-строку 64 Б
  const M = Math.floor(N / STRIDE);
  const order = new Uint32Array(M);
  for (let i = 0; i < M; i++) order[i] = i * STRIDE;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = M - 1; i > 0; i--) { const j = Math.floor(rnd() * i); const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (let i = 0; i < M; i++) next[order[i]] = order[(i + 1) % M];
  const STEPS = 20_000_000;
  const res = [];
  let p = order[0];
  for (let w = 0; w < 2_000_000; w++) p = next[p];  // прогрев JIT и TLB
  for (let r = 0; r < RUNS; r++) {
    const t0 = process.hrtime.bigint();
    for (let s = 0; s < STEPS; s++) p = next[p];
    const ns = Number(process.hrtime.bigint() - t0) / STEPS;
    res.push(ns);
  }
  res.sort((a, b) => a - b);
  const med = res[Math.floor(res.length / 2)];
  console.log(`mem-latency ${MB} МБ: медиана ${med.toFixed(1)} нс · прогоны ${res.map(x => x.toFixed(1)).join(' ')} · (p=${p})`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.slice(2).includes('--help')) { console.log("node tools/mem-latency.mjs [--mb 512] [--runs 5] — memory latency by pointer chase (median ns); compare only runs of this script on this machine"); process.exit(0); }
  process.exit(main(process.argv.slice(2)));
}
