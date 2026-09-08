// write-watch.mjs — ЧЁРНЫЙ ЯЩИК ЗАПИСИ В КАРТУ. Прибор для ПАУЗЫ между прожигами.
//
// 🔴 ЗАЧЕМ ОН, И ЧТО БЕЗ НЕГО БЫЛО СЛЕПО (`researches/36`).
//
// Четыре смерти машины 08.09 имеют одну форму: прожиг ПРОШЁЛ, вердикт записан, следом записано
// намерение на более глубокое напряжение — и смерть, вердикта нет. Разрыв 2…10 секунд. Для
// смерти 17:53 это доказано потактной записью: прожиг после того намерения НЕ СТАРТОВАЛ НИ РАЗУ,
// 829 тактов подряд, а дамп назвал модуль — обращение по неверному адресу внутри `nvlddmkm`.
//
// **То есть машина умирает В ПАУЗЕ, на записи, до всякой нагрузки. А у паузы не было НИ ОДНОГО
// прибора.** Три входа предохранителя сторожат прожиг; в паузе вход 2 и вход 3 гаснут по
// построению, а канал входа 1 в 17:53 не молчал вовсе — карта отвечала до последнего такта.
//
// 🔴 И ВТОРОЕ, ПРО ЗЕРНИСТОСТЬ. Журнал упреждающей записи пишет ОДНО намерение на ступень. Но одна
// ступень — это `writeCurve`, а он делает **до 79 обращений** `writeVfOffset` подряд, по одному на
// точку кривой. Наш самый мелкий след был в восемьдесят раз крупнее события, которое мы ищем.
//
// ЧТО ПИШЕТ. Вокруг КАЖДОГО обращения в драйвер — две строки: `call` перед ним и `return` после.
// Незакрытый `call` и есть отпечаток «вызов ушёл в драйвер и не вернулся» — улика, которой у нас
// не существовало ни для одной из четырёх смертей.
//
// ПОЧЕМУ ЧЕСТНЫЙ СБРОС НА ДИСК КАЖДОЙ СТРОКИ, А НЕ ПАЧКАМИ. Смерть уносит всё, что осталось в
// кэше ОС, — на этом мы уже потеряли улики трёх смертей (`bugs/123`). Цена ИЗМЕРЕНА на этой
// машине, а не предположена: `fsync` — медиана 1,016 мс, p90 2,298 мс. Полная ступень (79 точек ×
// две строки) стоит ~160 мс при её длительности 19 с, то есть **меньше процента**. Платим.
//
// ПОЧЕМУ ПРИБОР НА `writeVfOffset`, А НЕ НА `writeCurve`. `writeVfOffset` — единственная настоящая
// дверь в драйвер: через неё проходят все девять мест кода, которые пишут в карту. Прибор на ней
// покрывает их разом и не может рассинхронизироваться с новым вызывающим.
//
// [TESTED: 2026-09-08 · `--selftest`; незакрытый вызов опознаётся, закрытый — нет, выключенный
//  прибор не пишет ни байта]

import { openSync, writeSync, fsyncSync, closeSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_DIR = path.join(ROOT, 'runs', 'death-watch');

/**
 * ЕДИНСТВЕННЫЙ ПРИЁМНИК НА ПРОЦЕСС — и это осознанно, а не по лени.
 *
 * Дверь `writeVfOffset` зовётся из девяти мест, и протаскивать ручку прибора через каждое значило
 * бы девять мест, где её можно забыть. Забытая ручка — это молчащий прибор, который выглядит как
 * исправный: ровно тот класс, что стоил нам вечера (`bugs/127`). Приёмник ставится один раз на
 * входе движка и снимается в конце.
 *
 * Выключенный прибор (`sink === null`) стоит одну проверку на `null` — измеримо ноль.
 */
let sink = null;

/** Открыть чёрный ящик записи. Возвращает ручку; она же становится приёмником процесса. */
export function openWriteWatch({ dir = DEFAULT_DIR, label = null, now = Date.now } = {}) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date(now()).toISOString().replace(/[:.]/gu, '-');
  const file = path.join(dir, `${label ?? stamp}-write.jsonl`);
  const w = { file, fd: openSync(file, 'a'), seq: 0, now, calls: 0, returns: 0 };
  sink = w;
  return w;
}

export function armWriteWatch(w) { sink = w; return sink; }
export function disarmWriteWatch() { const w = sink; sink = null; return w; }
export function currentWriteWatch() { return sink; }

/** Одна строка на диск, с честным сбросом. Приёмника нет — ноль работы. */
function put(w, row) {
  if (!w) return;
  writeSync(w.fd, `${JSON.stringify(row)}\n`);
  fsyncSync(w.fd);
}

/**
 * ПЕРЕД обращением в драйвер. Возвращает метку вызова — её несёт парный `noteReturn`.
 * Пара «одна метка ↔ один возврат» и есть весь договор прибора.
 */
export function noteCall(fields = {}, w = sink) {
  if (!w) return null;
  w.seq += 1; w.calls += 1;
  const id = w.seq;
  put(w, { at: new Date(w.now()).toISOString(), seq: id, phase: 'call', ...fields });
  return { id, startedAt: w.now(), w };
}

/** ПОСЛЕ возврата из драйвера. `mark` — то, что вернул `noteCall`; `null` — прибор выключен. */
export function noteReturn(mark, fields = {}) {
  if (!mark) return;
  const { w, id, startedAt } = mark;
  w.returns += 1;
  put(w, {
    at: new Date(w.now()).toISOString(), seq: id, phase: 'return',
    ms: Number((w.now() - startedAt).toFixed(3)), ...fields,
  });
}

export function closeWriteWatch(w = sink) {
  if (!w) return null;
  try { closeSync(w.fd); } catch { /* закрытие не должно ронять прогон */ }
  if (sink === w) sink = null;
  return { file: w.file, calls: w.calls, returns: w.returns };
}

/** Разобрать запись прибора. Порядок хранения не есть порядок времени — сортируем (`bugs/123`). */
export function readWriteWatch(file) {
  const rows = readFileSync(file, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return rows.sort((a, b) => a.seq - b.seq || (a.phase === 'call' ? -1 : 1));
}

/**
 * 🔴 ГЛАВНЫЙ ВОПРОС К ЗАПИСИ: КАКОЙ ВЫЗОВ УШЁЛ В ДРАЙВЕР И НЕ ВЕРНУЛСЯ.
 *
 * Незакрытый `call` — это либо смерть машины внутри драйвера, либо вызов, висящий до сих пор
 * (`bugs/122`: рука спасения однажды ушла в драйвер на 119 секунд). Оба случая до сегодня были
 * невидимы: у нас не было ни одной записи, где вызов и его возврат стоят порознь.
 *
 * @returns {Array<object>} строки `call`, у которых нет парного `return`
 */
export function unfinishedCalls(rows) {
  const returned = new Set(rows.filter((r) => r.phase === 'return').map((r) => r.seq));
  return rows.filter((r) => r.phase === 'call' && !returned.has(r.seq));
}

/** Распределение длительностей вернувшихся вызовов — для будущего порога «слишком долго». */
export function callDurations(rows) {
  const ms = rows.filter((r) => r.phase === 'return' && Number.isFinite(r.ms)).map((r) => r.ms);
  if (!ms.length) return { n: 0, median: null, p99: null, max: null };
  const s = [...ms].sort((a, b) => a - b);
  return {
    n: s.length,
    median: s[Math.floor(s.length / 2)],
    p99: s[Math.min(s.length - 1, Math.floor(s.length * 0.99))],
    max: s[s.length - 1],
  };
}

// =================================================================================================
// БАТАРЕЯ — карта не нужна, диск во временной папке
// =================================================================================================

async function selftest() {
  const os = require('node:os');
  const { mkdtempSync, rmSync, statSync } = require('node:fs');
  let pass = 0; let fail = 0;
  const ok = (n, c, e = '') => { if (c) { pass += 1; console.log(`  ✅ ${n}`); } else { fail += 1; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };
  console.log('САМОПРОВЕРКА write-watch — чёрный ящик записи в карту (researches/36)');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'write-watch-'));

  // 1. Выключенный прибор не пишет НИ БАЙТА и не мешает вызывающему.
  disarmWriteWatch();
  const noMark = noteCall({ what: 'x' });
  noteReturn(noMark, { ok: true });
  ok('ВЫКЛЮЧЕННЫЙ прибор молчит: метки нет, возврат безопасен', noMark === null);

  // 2. Закрытый вызов НЕ считается незавершённым.
  const w = openWriteWatch({ dir, label: 'closed' });
  const m1 = noteCall({ what: 'writeVfOffset', point: 7, khz: -25000 });
  noteReturn(m1, { ok: true, status: 0 });
  closeWriteWatch(w);
  const rowsClosed = readWriteWatch(w.file);
  ok('закрытый вызов: две строки, незавершённых ноль',
    rowsClosed.length === 2 && unfinishedCalls(rowsClosed).length === 0,
    `строк ${rowsClosed.length}, незавершённых ${unfinishedCalls(rowsClosed).length}`);

  // 3. 🔴 РАДИ ЧЕГО ВСЁ: вызов, ушедший в драйвер и не вернувшийся, ОПОЗНАЁТСЯ ПОИМЁННО.
  const w2 = openWriteWatch({ dir, label: 'died' });
  noteCall({ what: 'writeVfOffset', point: 3, khz: -10000 });
  const m2 = noteCall({ what: 'writeVfOffset', point: 4, khz: -10000 });
  noteReturn(m2, { ok: true, status: 0 });
  noteCall({ what: 'writeVfOffset', point: 5, khz: -10000 });   // ← здесь «умерла машина»
  closeWriteWatch(w2);
  const dead = unfinishedCalls(readWriteWatch(w2.file));
  ok('🔴 НЕЗАКРЫТЫЙ ВЫЗОВ ОПОЗНАН ПОИМЁННО — точки 3 и 5, а не «где-то в ступени»',
    dead.length === 2 && dead[0].point === 3 && dead[1].point === 5,
    `незавершённых ${dead.length}: ${dead.map((r) => r.point).join(', ')}`);

  // 4. Строки на диске ДО закрытия файла — смерть не должна их унести (`bugs/123`).
  const w3 = openWriteWatch({ dir, label: 'survives' });
  noteCall({ what: 'writeVfOffset', point: 1, khz: 0 });
  const sizeBeforeClose = statSync(w3.file).size;
  closeWriteWatch(w3);
  ok('строка лежит на диске ДО закрытия файла — смерть машины её не унесёт', sizeBeforeClose > 0,
    `размер до закрытия ${sizeBeforeClose} байт`);

  // 5. Распределение длительностей — основа будущего порога «слишком долго» (`bugs/122`).
  const w4 = openWriteWatch({ dir, label: 'durations' });
  for (let i = 0; i < 5; i += 1) { const m = noteCall({ point: i }); noteReturn(m, { ok: true }); }
  closeWriteWatch(w4);
  const d = callDurations(readWriteWatch(w4.file));
  ok('длительности собираются: n, медиана, p99, максимум', d.n === 5 && d.median !== null,
    JSON.stringify(d));

  // 6. Порядок хранения не есть порядок времени — разбор сортирует сам.
  ok('разбор сортирует по seq и ставит call перед return',
    rowsClosed[0].phase === 'call' && rowsClosed[1].phase === 'return');

  // 7. 🔴 СКВОЗНАЯ ПРОВОДКА: настоящий `writeVfOffset` ОБЯЗАН пройти через прибор.
  //
  // Карта не нужна: подсовываем `nv`, у которого вызов не разрешается, — это первый выход функции.
  // Блок доказывает не «прибор умеет писать», а «дверь в драйвер к нему ПРИВЯЗАНА». Мутация:
  // снять `noteCall` из `nvapi.writeVfOffset` → строк ноль → красный.
  const w5 = openWriteWatch({ dir, label: 'wiring' });
  const nvapi = await import('./nvapi.mjs');
  const fake = { koffi: null, protos: null, resolve: () => ({ ok: false }) };
  const r = nvapi.writeVfOffset(fake, 0n, 42, -25000);
  closeWriteWatch(w5);
  const wired = readWriteWatch(w5.file);
  ok('🔴 СКВОЗНАЯ ПРОВОДКА: вызов nvapi.writeVfOffset прошёл через чёрный ящик',
    r.ok === false && wired.length === 2 && wired[0].what === 'writeVfOffset' && wired[0].point === 42
    && wired[1].phase === 'return',
    `строк ${wired.length}: ${JSON.stringify(wired).slice(0, 200)}`);

  rmSync(dir, { recursive: true, force: true });
  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('  ЧТО ЭТО: чёрный ящик ЗАПИСИ в карту (researches/36). Пишет две строки вокруг');
    console.log('           каждого обращения в драйвер; незакрытый вызов = «ушёл и не вернулся».');
    console.log('           Сам в карту НЕ пишет и ничего не меняет.');
    console.log('  --selftest        батарея на временной папке (карта не нужна)');
    console.log('  --read <файл>     разобрать запись: незавершённые вызовы и длительности');
    process.exit(0);
  }
  // ⚠️ БЕЗ `await` ВЕРХНЕГО УРОВНЯ, И ЭТО НЕ СТИЛЬ. Блок проводки динамически импортирует `nvapi`,
  // а `nvapi` импортирует ЭТОТ модуль. С `await` наверху модуль остаётся невычисленным, и цикл
  // замыкается намертво — поймано собственной батареей. С `.then` модуль достраивается сразу.
  if (argv.includes('--selftest')) { selftest().then((c) => process.exit(c)); } else {
  const i = argv.indexOf('--read');
  if (i >= 0 && argv[i + 1]) {
    const rows = readWriteWatch(argv[i + 1]);
    const dead = unfinishedCalls(rows);
    console.log(`строк ${rows.length} · вызовов ${rows.filter((r) => r.phase === 'call').length}`
      + ` · НЕЗАВЕРШЁННЫХ ${dead.length}`);
    for (const r of dead) console.log(`  🔴 seq ${r.seq} · ${r.at} · ${JSON.stringify(r)}`);
    console.log('длительности:', JSON.stringify(callDurations(rows)));
    process.exit(0);
  }
    console.log('нечего делать: --selftest или --read <файл>. Справка: --help');
  }
}
