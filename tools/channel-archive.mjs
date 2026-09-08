// channel-archive.mjs — АРХИВ КАНАЛА НАБЛЮДЕНИЯ: одна строка на прогон, из неё выводится число близости.
//
// `plans/51` фаза 6б. Разведка `researches/35` показала, что предвестник зависания живёт НЕ в
// показаниях карты, а в КАНАЛЕ НАБЛЮДЕНИЯ: задержка опроса, потеря проб, разрывы ряда, исчезновение
// метрик ([arXiv 2603.28781](https://arxiv.org/abs/2603.28781); их лучшая конфигурация даёт фору
// 7,0 окна против 2,0 у детекторов «только по карте»).
//
// Прибор ничего не решает и никаких порогов не содержит. Он СОБИРАЕТ: на каждый прогон — величины
// канала и ИСХОД. Порог выводится отдельно, фазой 6в, и выводится ИЗ ЭТОГО НАБОРА.
//
// ⚠️ ЧАСОВЫЕ ПОЯСА — ПАРА, ЗА КОТОРУЮ УЖЕ ЗАПЛАЧЕНО СЕГОДНЯ. Имена файлов сторожа и поле `atIso` —
// в UTC; журнал полосы и журнал Windows — в местном времени (+03:00). 08.09 агент сравнил одно с
// другим и на три минуты поверил, что машина не умирала, хотя она умерла. Здесь ВСЁ приводится к
// UTC в одном месте — в `toUtc` — и наружу печатается местное, помеченное явно.
//
// [TESTED: 2026-09-08 · --selftest на фикстурах; боевой архив прибором не правится, только читается]

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WATCH_DIR = join(ROOT, 'runs', 'death-watch');
export const DEATHS = join(ROOT, 'decisions', 'known-deaths.json');
export const OUT = join(ROOT, 'runs', 'channel-archive.json');

/** Метка времени прогона из имени файла: `2026-09-08T10-20-41-349Z` → UTC-миллисекунды. */
export function stampToUtc(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u.exec(stamp);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
}

/** Любая наша метка → UTC-миллисекунды. Принимает и `…Z`, и `…+03:00`; всё остальное — `null`. */
export function toUtc(iso) {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/u).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function stats(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0, min: null, med: null, p95: null, max: null };
  const at = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { n: a.length, min: a[0], med: at(0.5), p95: at(0.95), max: a[a.length - 1] };
}

/**
 * ИСХОД ПРОГОНА — по уликам, не по памяти.
 *  · `death`  — известная смерть машины попала в окно прогона (список из журнала Windows);
 *  · `rescue` — срабатываний предохранителя больше нуля, смерти не было;
 *  · `clean`  — ни того, ни другого.
 * Окно прогона расширено вперёд на `tailMs`: судья умирает ВМЕСТЕ с машиной, поэтому его последняя
 * строка стоит РАНЬШЕ отметки выключения, а не позже.
 */
export function outcomeOf({ startUtc, endUtc, trips, deaths, tailMs = 180_000 }) {
  const died = deaths.some((d) => d >= startUtc && d <= endUtc + tailMs);
  if (died) return 'death';
  return trips > 0 ? 'rescue' : 'clean';
}

/** Группировка файлов сторожа по метке прогона. */
export function groupRuns(names) {
  const runs = new Map();
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(.+)$/u.exec(n);
    if (!m) continue;
    const [, stamp, kind] = m;
    if (!runs.has(stamp)) runs.set(stamp, {});
    runs.get(stamp)[kind] = n;
  }
  return runs;
}

export function assemble({ dir = WATCH_DIR, deaths = [] } = {}) {
  // `readdirSync` уже отдаёт имена — `basename` здесь был лишним и ловил вторым доводом индекс
  // из `map`. Поймано первым же прогоном: прибор обязан краснеть на себе раньше, чем на данных.
  const runs = groupRuns(readdirSync(dir));
  const out = [];
  for (const [stamp, kinds] of runs) {
    const startUtc = stampToUtc(stamp);
    if (startUtc === null) continue;
    const probe = kinds['driver-alive.jsonl'] ? readLines(join(dir, kinds['driver-alive.jsonl'])) : [];
    const judge = kinds['fuse-alive.jsonl'] ? readLines(join(dir, kinds['fuse-alive.jsonl'])) : [];
    const fuse = kinds['fuse.jsonl'] ? readLines(join(dir, kinds['fuse.jsonl'])) : [];
    if (!probe.length && !judge.length) continue;
    const last = [...probe, ...judge].map((r) => toUtc(r.atIso)).filter((v) => v !== null);
    const endUtc = last.length ? Math.max(...last) : startUtc;
    const trips = fuse.filter((r) => r.phase === 'intent').length;

    // ── ВЕЛИЧИНЫ КАНАЛА, по списку источника ───────────────────────────────────────────────────
    const row = {
      stamp,
      startLocal: new Date(startUtc).toLocaleString('ru-RU'),
      seconds: Math.round((endUtc - startUtc) / 1000),
      trips,
      rearms: fuse.filter((r) => r.action === 'rearm' && r.ok === true).length,
      outcome: outcomeOf({ startUtc, endUtc, trips, deaths }),
      // задержка ответа драйвера — прямой аналог «scrape latency» источника
      callMs: stats(probe.map((r) => r.worstCallMs)),
      // опоздание такта пробы — «time-series gaps»
      overshootMs: stats(probe.map((r) => r.worstOvershootMs)),
      // потеря проб — «sample loss»
      misses: probe.reduce((s, r) => s + (r.misses ?? 0), 0),
      probeTicks: stats(probe.map((r) => r.ticks)),
      // разрыв такта СУДЬИ — второй независимый наблюдатель того же канала
      judgeGapMs: stats(judge.map((r) => r.worstGapMs)),
      judgeTicks: stats(judge.map((r) => r.ticks)),
      // застывание метрики — «metric disappearance»
      powerSeconds: judge.filter((r) => r.minPowerMw != null).length,
      powerDistinct: new Set(judge.map((r) => r.minPowerMw).filter((v) => v != null)).size,
    };
    out.push(row);
  }
  return out.sort((a, b) => a.stamp.localeCompare(b.stamp));
}

function loadDeaths() {
  if (!existsSync(DEATHS)) return [];
  try {
    const d = JSON.parse(readFileSync(DEATHS, 'utf8'));
    return (d.deaths ?? []).map((x) => toUtc(x.at)).filter((v) => v !== null);
  } catch { return []; }
}

function selftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА channel-archive: боевой архив НЕ читается, только фикстуры');
  ok('метка прогона разбирается в UTC и НЕ уезжает на пояс',
    stampToUtc('2026-09-08T10-20-41-349Z') === Date.UTC(2026, 8, 8, 10, 20, 41, 349));
  ok('чужая метка отвергается, а не угадывается', stampToUtc('вчера вечером') === null);
  ok('🔴 ПОЯСА СВОДЯТСЯ В ОДНОМ МЕСТЕ: `…10:02:25Z` и `…13:02:25+03:00` — ОДИН миг',
    toUtc('2026-09-08T10:02:25.600Z') === toUtc('2026-09-08T13:02:25.600+03:00'));
  const t = Date.UTC(2026, 8, 8, 10, 0, 0);
  ok('смерть ВНУТРИ окна прогона даёт исход «death»',
    outcomeOf({ startUtc: t, endUtc: t + 60_000, trips: 0, deaths: [t + 30_000] }) === 'death');
  ok('смерть ПОСЛЕ последней строки, но в хвосте, тоже даёт «death» — судья умирает раньше отметки',
    outcomeOf({ startUtc: t, endUtc: t + 60_000, trips: 0, deaths: [t + 100_000] }) === 'death');
  ok('смерть ДАЛЕКО за хвостом не приписывается прогону',
    outcomeOf({ startUtc: t, endUtc: t + 60_000, trips: 0, deaths: [t + 600_000] }) === 'clean');
  ok('срабатывание без смерти — «rescue», а не «death»',
    outcomeOf({ startUtc: t, endUtc: t + 60_000, trips: 2, deaths: [] }) === 'rescue');
  ok('группировка собирает разные виды файлов под одной меткой',
    Object.keys(groupRuns(['2026-09-08T10-20-41-349Z-fuse.jsonl', '2026-09-08T10-20-41-349Z-fuse-alive.jsonl'])
      .get('2026-09-08T10-20-41-349Z')).length === 2);
  const s = stats([5, 1, 3]);
  ok('сводка величины: минимум, медиана и максимум вместе, пустой список — честные null',
    s.min === 1 && s.med === 3 && s.max === 5 && stats([]).med === null);
  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

function help() {
  console.log('  ЧТО ЭТО: сборщик архива канала наблюдения (plans/51 фаза 6б). Только ЧИТАЕТ');
  console.log('           runs/death-watch и список смертей; карту не трогает вовсе.');
  console.log('  --selftest   самопроверка на фикстурах');
  console.log('  --write      записать набор в runs/channel-archive.json');
  console.log('  без флагов   напечатать таблицу прогонов');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { help(); process.exit(0); }
  if (argv.includes('--selftest')) process.exit(selftest());
  const deaths = loadDeaths();
  const rows = assemble({ deaths });
  const by = { death: 0, rescue: 0, clean: 0 };
  for (const r of rows) by[r.outcome] += 1;
  console.log(`ПРОГОНОВ В АРХИВЕ: ${rows.length} · смертей ${by.death} · спасений ${by.rescue} · чистых ${by.clean}`);
  console.log(`СМЕРТЕЙ В СПИСКЕ (из журнала Windows): ${deaths.length}`);
  console.log();
  console.log('прогон (местное)      с   исход   ответ драйвера, мс      разрыв судьи, мс     потерь  мощн.');
  console.log('                                   мед / p95 / макс        мед / p95 / макс');
  for (const r of rows) {
    const c = r.callMs; const g = r.judgeGapMs;
    const f = (x) => (x === null ? '—' : String(Math.round(x * 100) / 100));
    console.log(
      `${r.startLocal.padEnd(20)} ${String(r.seconds).padStart(4)}  ${r.outcome.padEnd(7)}`
      + ` ${f(c.med).padStart(6)}/${f(c.p95).padStart(6)}/${f(c.max).padStart(7)}`
      + `  ${f(g.med).padStart(6)}/${f(g.p95).padStart(7)}/${f(g.max).padStart(8)}`
      + ` ${String(r.misses).padStart(6)} ${String(r.powerDistinct).padStart(5)}`,
    );
  }
  if (argv.includes('--write')) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify({ builtAt: new Date().toISOString(), deaths: deaths.length, rows }, null, 2)}\n`);
    console.log(`\nнабор записан: ${OUT}`);
  }
}
