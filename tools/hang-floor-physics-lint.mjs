// hang-floor-physics-lint.mjs — СТЕНА ЗАВИСАНИЯ НЕ МОЖЕТ ПРОТИВОРЕЧИТЬ ФИЗИКЕ.
//
// `bugs/124`. Найдено НЕ агентом, а подозрением владельца 2026-09-08: *«1135 мв - зависание - я
// ПОЧТИ УВЕРЕН, что ты неправ и это фрод»*. Он был прав, и проверка это показала числом.
//
// ЧТО СУДИТСЯ, И ПОЧЕМУ ЭТО ФИЗИКА, А НЕ ВКУС. Более высокой частоте кремний требует БОЛЬШЕГО
// напряжения, не меньшего — это монотонность кривой частота→напряжение, на которой стоит весь
// проект. Значит утверждение «частота F зависла на V» несовместимо с фактом «частота выше F ПРОШЛА
// прожиг на напряжении НИЖЕ V»: если бы V действительно было непроходимым для F, соседка сверху не
// прошла бы тем более. Порога здесь нет вовсе — сравниваются два наших же замера.
//
// ОТКУДА БЕРУТСЯ ЛОЖНЫЕ СТЕНЫ (механизм, найденный в журнале). `hangFloors` считает полом ЛЮБОЕ
// намерение без вердикта. Для настоящей смерти это верно: вердикт писать стало некому. Но вердикт
// не пишется и после СПАСЕНИЯ предохранителя — по слову самого движка, «прожиг после спасения идёт
// по ЗАВОДСКОЙ кривой и ничего не доказывает». Спасение при этом возвращает карту на сток, поэтому
// изготовленная стена садится на почти стоковое напряжение: 3052 МГц «зависла» на 1135 мВ при стоке
// 1160, тогда как 3067 МГц — ЧАСТОТА ВЫШЕ — прошла на 935 мВ.
//
// ЦЕНА КЛАССА: стена запирает спуск навсегда (`bugs/23`), то есть ложная стена крадёт настоящий
// андервольт и отравляет метки будущего предсказателя (`plans/51` фаза 6).
//
// [TESTED: 2026-09-08 · боевой журнал: стен 20, противоречащих физике 7, все заморожены в базу
//  долга до перепрожига; --selftest на фикстурах, боевой журнал батареей не читается]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'decisions', 'hang-floor-physics-baseline.json');

/**
 * ЧИСТОЕ ЯДРО — сравнивает стены с доказанно прошедшими напряжениями. Никаких файлов, никаких
 * порогов: только два множества замеров.
 *
 * @param {Map<number,{voltageMv:number}>|Array} floors  стены: частота → напряжение
 * @param {Map<number,number>} passed  частота → САМОЕ НИЗКОЕ напряжение, на котором она ПРОШЛА
 * @returns {Array<{mhz:number,wallMv:number,higherMhz:number,passedMv:number,gapMv:number}>}
 */
export function contradictions(floors, passed) {
  const out = [];
  const entries = floors instanceof Map ? [...floors.entries()] : floors;
  for (const [mhzRaw, f] of entries) {
    const mhz = Number(mhzRaw);
    const wallMv = typeof f === 'number' ? f : f?.voltageMv;
    if (!Number.isFinite(mhz) || !Number.isFinite(wallMv)) continue;
    let worst = null;
    for (const [pfRaw, pv] of passed) {
      const pf = Number(pfRaw);
      // Строго ВЫШЕ по частоте и строго НИЖЕ по напряжению — иначе противоречия нет.
      if (pf > mhz && pv < wallMv) {
        const gapMv = wallMv - pv;
        if (worst === null || gapMv > worst.gapMv) worst = { mhz, wallMv, higherMhz: pf, passedMv: pv, gapMv };
      }
    }
    if (worst !== null) out.push(worst);
  }
  return out.sort((a, b) => b.gapMv - a.gapMv);
}

/** Ключ строки долга — частота и напряжение стены: сдвинулось напряжение, значит стена ДРУГАЯ. */
export function debtKey(c) { return `${c.mhz}@${c.wallMv}`; }

async function readLive() {
  const J = await import('../automation-engine/lib/sweep-journal.mjs');
  const { records } = J.readJournal(J.openJournal({}));
  const floors = J.hangFloors(records);
  const intents = new Map(records.filter((r) => r?.state === 'intent').map((r) => [r.seq, r]));
  const passed = new Map();
  for (const r of records) {
    if (r?.state !== 'verdict') continue;
    if (String(r.outcome).toLowerCase() !== 'passed') continue;
    const i = intents.get(r.seq);
    if (!i?.frequencyMhz || !i?.voltageMv) continue;
    const cur = passed.get(i.frequencyMhz);
    if (cur == null || i.voltageMv < cur) passed.set(i.frequencyMhz, i.voltageMv);
  }
  return { floors, passed };
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return { keys: [] };
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return { keys: [] }; }
}

export async function run({ freeze = false } = {}) {
  const { floors, passed } = await readLive();
  const bad = contradictions(floors, passed);
  const keys = bad.map(debtKey);
  if (freeze) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify({
      why: 'bugs/124 — стены, изготовленные спасением предохранителя. Снимаются перепрожигом, не переклейкой.',
      frozenAt: new Date().toISOString(),
      keys,
    }, null, 2)}\n`);
  }
  const base = new Set(loadBaseline().keys ?? []);
  const fresh = bad.filter((c) => !base.has(debtKey(c)));
  const line = `ФИЗИКА СТЕН (bugs/124): стен ${floors.size ?? [...floors].length} · `
    + `противоречат физике ${bad.length} · новых ${fresh.length} · в долге ${base.size}`;
  return { ok: fresh.length === 0, line, bad, fresh };
}

function selftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА hang-floor-physics: боевой журнал НЕ читается, только фикстуры');

  // Настоящие числа 08.09: стена 3052@1135 против прошедшей 3067@935.
  const floors = new Map([[3052, { voltageMv: 1135 }], [3067, { voltageMv: 925 }]]);
  const passed = new Map([[3067, 935]]);
  const bad = contradictions(floors, passed);
  ok('🔴 НАСТОЯЩИЙ СЛУЧАЙ 08.09: стена 3052@1135 противоречит прошедшей 3067@935 — противоречие 200 мВ',
    bad.length === 1 && bad[0].mhz === 3052 && bad[0].gapMv === 200, JSON.stringify(bad));
  ok('ПОДЛИННАЯ стена 3067@925 НЕ обвиняется — выше неё частот с прожигом нет',
    !bad.some((c) => c.mhz === 3067), JSON.stringify(bad));
  ok('монотонная картина противоречий не даёт: стена ниже прошедшего у соседки сверху',
    contradictions(new Map([[2800, { voltageMv: 850 }]]), new Map([[2900, 900]])).length === 0);
  ok('равенство противоречием НЕ считается — граница исключающая с обеих сторон',
    contradictions(new Map([[2800, { voltageMv: 900 }]]), new Map([[2900, 900]])).length === 0);
  ok('частота НИЖЕ стены не судит её вовсе — сравнение только вверх по частоте',
    contradictions(new Map([[2900, { voltageMv: 1000 }]]), new Map([[2800, 900]])).length === 0);
  ok('берётся ХУДШЕЕ противоречие, а не первое встречное',
    contradictions(new Map([[3052, { voltageMv: 1135 }]]), new Map([[3060, 1015], [3067, 935]]))[0].gapMv === 200);
  ok('мусор в данных не роняет прибор и не выдумывает противоречий',
    contradictions(new Map([[NaN, { voltageMv: 1 }], [3000, {}]]), new Map([[3100, 900]])).length === 0);
  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

function help() {
  console.log('  ЧТО ЭТО: сторож физики стен зависания (bugs/124). Читает журнал полосы и документ');
  console.log('           кривой, ничего не пишет в карту и ничего не правит.');
  console.log('  --selftest   прогнать самопроверку на фикстурах (боевой журнал не читается)');
  console.log('  --freeze     заморозить текущие противоречия в базу долга');
  console.log('  без флагов   судить боевой журнал и напечатать строку сторожа');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { help(); process.exit(0); }
  if (argv.includes('--selftest')) process.exit(selftest());
  run({ freeze: argv.includes('--freeze') }).then((r) => {
    console.log(r.line);
    if (r.fresh.length) {
      for (const c of r.fresh) {
        console.log(`  НОВОЕ: ${c.mhz} МГц стена ${c.wallMv} мВ — но ${c.higherMhz} МГц ПРОШЛА на ${c.passedMv} мВ (противоречие ${c.gapMv} мВ)`);
      }
    }
    process.exit(r.ok ? 0 : 1);
  });
}
