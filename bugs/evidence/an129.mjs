// Разбор улик bugs/129 AC1: что именно не оживает — карта, драйвер или наш замер её здоровья.
// Только чтение файлов под git. Ни одного вывода из головы: каждая строка ниже — из записи.
import { readFileSync } from 'node:fs';

const R = 'bugs/evidence/p94_ring_nine_rescues_2026-09-08T19-21.jsonl';
const T = 'bugs/evidence/p94_trips_nine_rescues_2026-09-08T19-21.jsonl';

const rows = readFileSync(R, 'utf8').trim().split(/\r?\n/u).map((l) => JSON.parse(l));
const trips = readFileSync(T, 'utf8').trim().split(/\r?\n/u).map((l) => JSON.parse(l));

console.log(`кольцо: ${rows.length} тактов · t от ${rows[0].t} до ${rows[rows.length - 1].t} мс`);
console.log(`журнал трипов: ${trips.length} строк\n`);

// ── 1. ЧТО НАШЛА РУКА 1 НА КАЖДОМ ТРИПЕ ───────────────────────────────────────────────────────
console.log('=== 1. НА КАЖДОМ ТРИПЕ: БЫЛ ЛИ ЖИВОЙ ПРОЖИГ, КОТОРЫЙ МОЖНО УБИТЬ ===');
const intents = trips.filter((x) => x.phase === 'intent');
const kills = trips.filter((x) => x.action === 'kill-burn');
console.log(`намерений (трипов): ${intents.length} · попыток убить прожиг: ${kills.length}`);
let notFound = 0;
for (const [i, k] of kills.entries()) {
  const d = k.detail ?? '';
  const found = !/не найден/u.test(d) || /убит/u.test(d);
  if (!found) notFound += 1;
  console.log(`  трип ${i + 1}: ${k.at} · ${found ? 'ПРОЖИГ БЫЛ' : '🔴 ПРОЖИГА НЕТ'} · ${d.slice(0, 90)}`);
}
console.log(`ИТОГ: трипов, на которых прожига уже не было: ${notFound} из ${kills.length}\n`);

// ── 2. ПРИЧИНЫ ────────────────────────────────────────────────────────────────────────────────
const byCause = {};
for (const x of intents) byCause[x.cause] = (byCause[x.cause] ?? 0) + 1;
console.log('=== 2. ПРИЧИНЫ ТРИПОВ ===');
console.log(JSON.stringify(byCause), '\n');

// ── 3. МОЩНОСТЬ ДО И ПОСЛЕ КАЖДОГО СПАСЕНИЯ ──────────────────────────────────────────────────
// Вопрос AC1 дословно: оживает ли КАРТА. Наблюдаемая величина, которую подделать нечем, —
// мощность карты, приходящая ударами пробы. Если после спасения карта считает, мощность обязана
// снова подняться под следующим прожигом; если карта не оживает, она останется у покоя.
const live = rows.filter((r) => r.powerMw !== null && r.powerMw !== undefined);
console.log('=== 3. МОЩНОСТЬ ПО ХОДУ ПРОГОНА (мВт) ===');
console.log(`строк с мощностью: ${live.length} из ${rows.length}`);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mws = live.map((r) => r.powerMw);
console.log(`мин ${Math.min(...mws)} · медиана ${q(mws, 0.5)} · p90 ${q(mws, 0.9)} · max ${Math.max(...mws)}\n`);

// Разрежем прогон по моментам трипов (в миллисекундах от старта судьи).
const t0 = Date.parse(trips[0].at);
const tripT = intents.map((x) => Date.parse(x.at) - t0 + rows.find((r) => r.beatSilenceMs !== null)?.t ?? 0);
console.log('=== 4. ОКНА МЕЖДУ СПАСЕНИЯМИ: ЧТО ПОКАЗЫВАЛА КАРТА ===');
console.log('(окно = от одного трипа до следующего; смотрим, поднималась ли мощность снова)');
const marks = [rows[0].t, ...intents.map((x, i) => {
  // трипы идут по времени; переводим их в шкалу кольца по доле пройденного
  const span = Date.parse(intents[intents.length - 1].at) - Date.parse(intents[0].at);
  const frac = span === 0 ? 0 : (Date.parse(x.at) - Date.parse(intents[0].at)) / span;
  return rows[0].t + frac * (rows[rows.length - 1].t - rows[0].t);
}), rows[rows.length - 1].t];
for (let i = 0; i < marks.length - 1; i += 1) {
  const seg = rows.filter((r) => r.t >= marks[i] && r.t < marks[i + 1] && r.powerMw !== null);
  if (seg.length === 0) { console.log(`  окно ${i}: строк с мощностью нет`); continue; }
  const p = seg.map((r) => r.powerMw);
  const wired = seg.filter((r) => r.progressSilenceMs !== null).length;
  console.log(`  окно ${i}: тактов ${seg.length} · мощность мин ${Math.min(...p)} макс ${Math.max(...p)} медиана ${q(p, 0.5)} · провод жив в ${wired}`);
}
