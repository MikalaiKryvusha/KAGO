// bugs/129 AC1, второе чтение: что показывала карта В СЕКУНДЫ ПЕРЕД каждым трипом.
// Вопрос: провал мощности — это остановившаяся карта или ЗАКОНЧИВШИЙСЯ прожиг?
import { readFileSync } from 'node:fs';

const rows = readFileSync('bugs/evidence/p94_ring_nine_rescues_2026-09-08T19-21.jsonl', 'utf8')
  .trim().split(/\r?\n/u).map((l) => JSON.parse(l));
const trips = readFileSync('bugs/evidence/p94_trips_nine_rescues_2026-09-08T19-21.jsonl', 'utf8')
  .trim().split(/\r?\n/u).map((l) => JSON.parse(l));

// Трип виден В САМОМ КОЛЬЦЕ: это такт, где тишина прогресса впервые перевалила уставку M = 1177 мс.
const M = 1177;
const marks = [];
let armed = true;
for (const r of rows) {
  const s = r.progressSilenceMs;
  if (s === null || s === undefined) { armed = true; continue; }
  if (armed && s >= M) { marks.push(r); armed = false; }
  if (s < 200) armed = true;
}
console.log(`тактов в кольце: ${rows.length} · моментов «тишина ≥ M»: ${marks.length} (журнал трипов: ${trips.filter((x) => x.phase === 'intent').length})\n`);

const at = (t) => rows.filter((r) => r.t >= t - 6000 && r.t <= t + 1500);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : null; };

console.log('=== ЧТО БЫЛО В ШЕСТЬ СЕКУНД ПЕРЕД КАЖДЫМ ТРИПОМ ===');
console.log('(если карта ВСТАЛА — мощность держится высокой и вдруг замерзает;');
console.log(' если прожиг КОНЧИЛСЯ — мощность плавно уходит к покою, и провода прогресса больше нет)\n');
for (const [i, m] of marks.entries()) {
  const w = at(m.t);
  const mw = w.map((r) => r.powerMw).filter((x) => x !== null && x !== undefined);
  if (mw.length === 0) { console.log(`трип ${i + 1}: мощности в окне нет`); continue; }
  const first = mw.slice(0, Math.max(1, Math.floor(mw.length / 6)));
  const last = mw.slice(-Math.max(1, Math.floor(mw.length / 6)));
  // Сколько РАЗНЫХ значений мощности в последней секунде: замёрзшая телеметрия даёт 1.
  const lastSec = w.filter((r) => r.t >= m.t - 1000 && r.powerMw !== null).map((r) => r.powerMw);
  const distinct = new Set(lastSec).size;
  console.log(`трип ${i + 1} (t=${Math.round(m.t)} мс · тишина ${Math.round(m.progressSilenceMs)} мс · доля ${m.powerRatio}):`);
  console.log(`   мощность за 6 с ДО: начало ${q(first, 0.5)} мВт → конец ${q(last, 0.5)} мВт · разных значений в последнюю секунду: ${distinct}`);
}

// ── Сколько времени карта проводила НА НАГРУЗКЕ между трипами: жива ли она вообще ──────────────
console.log('\n=== КАРТА МЕЖДУ СПАСЕНИЯМИ: БЫЛА ЛИ ОНА ПОД ПОЛНОЙ НАГРУЗКОЙ ===');
const HIGH = 250_000; // мВт: карта реально считает
for (let i = 0; i < marks.length; i += 1) {
  const from = marks[i].t;
  const to = i + 1 < marks.length ? marks[i + 1].t : rows[rows.length - 1].t;
  const seg = rows.filter((r) => r.t > from && r.t <= to && r.powerMw !== null);
  const high = seg.filter((r) => r.powerMw >= HIGH).length;
  const secs = Math.round((to - from) / 1000);
  console.log(`  после спасения ${i + 1}: окно ${secs} с · тактов ${seg.length} · под полной нагрузкой (≥250 Вт) ${high} тактов (${seg.length ? Math.round((high / seg.length) * 100) : 0} %)`);
}
