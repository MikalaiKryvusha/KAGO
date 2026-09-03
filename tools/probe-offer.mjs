/**
 * ПРОБА ПРЕДЛОЖЕНИЯ КАРТЫ — сколько наш вектор предлагает над максимумом карты. ТОЛЬКО ЧТЕНИЕ.
 *
 * Прибор критерия **P83-AC6** (`plans/83` Ш6): «после остывания карты превышения нет». Живёт в
 * `tools/`, а не в движке, по границе внешней карты: здесь то, что оператор запускает рукой и что
 * состояния GPU НЕ ТРОГАЕТ. Ни одной записи — два чтения (`readVfCurveStable`,
 * `readVfOffsetsStable`) и `nvidia-smi` в режиме опроса.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРИБОР, а не строка в существующем: на этот вопрос не отвечает ни один из уже
 * стоящих. `curve --reference` меряет расстояние опоры до ЖИВОЙ таблицы (а живая несёт наши сдвиги);
 * `profile --state` печатает ватты и текущую частоту; журнал прогона про таблицу молчит вовсе. Тот же
 * случай, что и у `npm run hold` (`bugs/87`): вопрос есть, а прибора под него нет.
 *
 * 🔴 РАЗЛИЧЕНИЕ, БЕЗ КОТОРОГО ЧИСЛО ЛОЖНОЕ — оно же причина, по которой сторож потолка не читает
 * «наивысшее предложение вообще» (`nvapi.mjs` → `highestRaisedOfferMhz`, замер 2026-08-15):
 * ЗАВОДСКАЯ вершина этой карты (3157…3172 МГц) САМА выше её максимума 3090. Точки, которых мы не
 * поднимали, — не наши: мы их не писали и вниз не давим. Мерить надо предложение на ПОДНЯТЫХ НАМИ
 * точках (сдвиг > 0), иначе прибор краснеет на заводском состоянии.
 *
 * Максимум карты ЧИТАЕТСЯ (`nvidia-smi clocks.max.gr`), а не вписан константой: вписанное число
 * становится ложью в тот час, когда меняется драйвер.
 *
 * [TESTED: 2026-09-04 · `--selftest` — 9 блоков на фикстурах без карты, мутации «поднятой считать
 *  точку со сдвигом ≥ 0» и «превышением считать равенство» красят ровно свои блоки; в батарее как
 *  `probeoffer`. Живьём наблюдён 2026-09-01 18:0x: карта в `optimised`, 54 °C, через 7,5 ч после
 *  записи — 0 поднятых точек над максимумом, плато 3067 МГц; арифметика сверена ТРЕТЬИМ чтением —
 *  живой вектор сошёлся с инверсией документа кривой на 51 точке из 51 (разбор — `plans/83` Ш6).]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nvapi from '../automation-engine/lib/nvapi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Одна опросная строка `nvidia-smi` — читает, не пишет. */
function askCard() {
  const fields = 'clocks.max.gr,clocks.gr,temperature.gpu,power.draw,pstate,fan.speed';
  const out = execFileSync('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'])
    .toString().trim().split(', ');
  const [maxMhz, clockMhz, tempC, wattsW, pstate, fanPct] = out;
  return {
    maxMhz: Number(maxMhz), clockMhz: Number(clockMhz), tempC: Number(tempC),
    wattsW: Number(wattsW), pstate, fanPct: Number(fanPct),
  };
}

/**
 * ЧИСТАЯ АРИФМЕТИКА — вынесена из ввода-вывода, чтобы её можно было судить без карты.
 *
 * Заводская частота точки есть «живая минус её сдвиг» — то же тождество, на котором стоит снятие
 * опоры (`profile-manager.mjs`). Поднятой считается точка со сдвигом СТРОГО больше нуля: нулевой
 * сдвиг это «мы её не трогали», а отрицательных наш отгружаемый вектор не ставит.
 */
export function judgeOffer(points, offsetsKhz, envelopeMhz) {
  const rows = [];
  for (const p of points) {
    if (!p || p.freqKhz <= 0) continue;
    const off = (offsetsKhz[p.i] ?? 0) / 1000;
    rows.push({ i: p.i, mv: p.mv, offer: p.mhz, off, factory: p.mhz - off });
  }
  const raised = rows.filter((r) => r.off > 0);
  const over = raised.filter((r) => r.offer > envelopeMhz);
  return {
    rows,
    raisedCount: raised.length,
    raisedOverEnvelope: over.length,
    overPoints: over,
    highestRaisedOfferMhz: raised.length ? Math.max(...raised.map((r) => r.offer)) : null,
    // Держится отдельно и НЕ судится: заводская вершина выше максимума карты сама по себе.
    highestOfferedAnyMhz: rows.length ? Math.max(...rows.map((r) => r.offer)) : null,
  };
}

/**
 * САМОПРОВЕРКА АРИФМЕТИКИ — без карты, без nvapi, без `nvidia-smi`. Судится только `judgeOffer`:
 * ввод-вывод прибора наблюдается живьём (шапка), а решение «что считать превышением» — здесь.
 *
 * Адресаты мутаций названы ДО прогона (EXP-0016): (M1) «поднятой считать точку со сдвигом ≥ 0» — красит
 * блок про заводскую точку над максимумом; (M2) «превышением считать равенство» — красит блок про точку
 * ровно на максимуме; (M3) «сдвиг брать в кГц, а не в МГц» — красит блок арифметики заводской частоты.
 */
function selfTest() {
  const blocks = [];
  const check = (name, ok, detail = '') => blocks.push({ name, ok, detail });
  const P = (i, mv, mhz) => ({ i, mv, mhz, freqKhz: mhz * 1000 });
  const ENV = 3090;
  // Фикстура повторяет ЗАМЕР этой карты, а не удобство: заводская вершина (#127) выше максимума сама
  // по себе; наши поднятые точки — ниже неё; одна поднятая точка выведена сдвигом ровно на максимум.
  // ⚠️ Точки — ЖИВЫЕ, как их отдаёт `readVfCurveStable`: частота УЖЕ несёт сдвиг. Первая редакция
  // фикстуры подала заводские частоты, и три блока покраснели на верном коде — урок про то, что
  // фикстура повторяет ФОРМУ ввода прибора, а не удобное для автора число.
  const points = [
    P(0, 450, 0),              // дыра: частоты нет — не точка
    P(100, 1000, 3067),        // поднята +180: заводские 2887 → предлагает 3067
    P(110, 1100, 3090),        // поднята +190: предлагает РОВНО максимум
    P(116, 1175, 3097),        // поднята +30: заводские 3067 → предлагает 3097, ВЫШЕ максимума
    P(120, 1200, 3120),        // придавлена −30: предлагает 3120, но она НЕ поднята — не наша
    P(127, 1240, 3157),        // заводская вершина, сдвиг 0: не наша
  ];
  const off = []; off[100] = 180_000; off[110] = 190_000; off[116] = 30_000; off[120] = -30_000; off[127] = 0;
  // Замечание к форме: `judgeOffer` читает сдвиг по ИНДЕКСУ точки (`offsetsKhz[p.i]`), а не по позиции
  // в массиве — так устроен и живой ввод (`readVfOffsetsStable` отдаёт 127 сдвигов по индексу).
  const v = judgeOffer(points, off, ENV);

  check('дыра (частота 0) не входит в строки', v.rows.length === 5 && !v.rows.some((r) => r.i === 0), `строк ${v.rows.length}`);
  check('поднятыми считаются ТОЛЬКО точки со сдвигом > 0 — их три', v.raisedCount === 3, `${v.raisedCount}`);
  check('заводская вершина над максимумом (сдвиг 0) превышением НЕ считается — иначе прибор краснел бы на заводской карте',
    !v.overPoints.some((r) => r.i === 127), JSON.stringify(v.overPoints.map((r) => r.i)));
  check('придавленная точка (сдвиг < 0) не считается поднятой', !v.overPoints.some((r) => r.i === 120) && v.raisedCount === 3);
  check('точка РОВНО на максимуме — не превышение (граница включительно)', !v.overPoints.some((r) => r.i === 110));
  check('точка выше максимума на поднятой — превышение, и ровно одна', v.raisedOverEnvelope === 1 && v.overPoints[0]?.i === 116, JSON.stringify(v.overPoints));
  check('наивысшее НА ПОДНЯТЫХ — 3097, наивысшее ВООБЩЕ — 3157, и это два разных числа',
    v.highestRaisedOfferMhz === 3097 && v.highestOfferedAnyMhz === 3157, `${v.highestRaisedOfferMhz} / ${v.highestOfferedAnyMhz}`);
  check('заводская частота = предложение − сдвиг в МГц (кГц переведены)',
    v.rows.find((r) => r.i === 116)?.factory === 3067 && v.rows.find((r) => r.i === 116)?.off === 30,
    JSON.stringify(v.rows.find((r) => r.i === 116)));
  const none = judgeOffer([P(5, 800, 2000)], [], ENV);
  check('ничего не поднято → наивысшее на поднятых null, а не 0 и не −Infinity', none.highestRaisedOfferMhz === null && none.raisedCount === 0);

  for (const b of blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
  const failed = blocks.filter((b) => !b.ok).length;
  console.log(`\nСАМОПРОВЕРКА ПРОБЫ ПРЕДЛОЖЕНИЯ: ${blocks.length} блоков, провалов ${failed}. Карта не читалась.`);
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--selftest')) return selfTest();
  const card = askCard();
  const nv = nvapi.openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${nvapi.statusName(st)}`); return 1; }
  try {
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    if (count.readUInt32LE(0) < 1) { console.error('карт не найдено'); return 1; }
    const handle = handles.readBigUInt64LE(0);

    // Оба чтения СХОДЯЩИЕСЯ (`*Stable`): одиночная проба структуры на этой карте разъезжается между
    // выборками, и на этом уже обжигались — `readUntilStable` существует ровно за этим.
    const curve = nvapi.readVfCurveStable(nv, handle);
    const ctl = nvapi.readVfOffsetsStable(nv, handle);
    if (!curve.ok) { console.error(`ТАБЛИЦА НЕ ПРОЧИТАНА: ${curve.why}`); return 1; }
    if (!ctl.ok) { console.error(`СДВИГИ НЕ ПРОЧИТАНЫ: ${ctl.why}`); return 1; }

    const v = judgeOffer(curve.points, ctl.offsets, card.maxMhz);

    console.log('');
    console.log('ПРЕДЛОЖЕНИЕ КАРТЫ ПРОТИВ ЕЁ МАКСИМУМА — только чтение (P83-AC6)');
    console.log('─'.repeat(78));
    console.log(`карта: ${card.tempC} °C · ${card.wattsW} Вт · ${card.pstate} · вентилятор ${card.fanPct} % · частота ${card.clockMhz} МГц`);
    console.log(`максимум карты (ЧИТАН, не вписан): ${card.maxMhz} МГц`);
    console.log(`сдвигов ненулевых: ${ctl.nonZero} из ${curve.points.length} · поднятых нами: ${v.raisedCount}`);
    console.log('');
    console.log(`  наивысшее предложение НА ПОДНЯТЫХ НАМИ: ${v.highestRaisedOfferMhz ?? '—'} МГц`
      + (v.highestRaisedOfferMhz === null ? '' : ` (${v.highestRaisedOfferMhz - card.maxMhz > 0 ? '+' : ''}${v.highestRaisedOfferMhz - card.maxMhz} к максимуму)`));
    console.log(`  наивысшее предложение ВООБЩЕ:          ${v.highestOfferedAnyMhz} МГц`
      + ` (${v.highestOfferedAnyMhz - card.maxMhz > 0 ? '+' : ''}${v.highestOfferedAnyMhz - card.maxMhz}) — заводские точки, мы их не поднимали`);
    console.log('');
    const verdict = v.raisedOverEnvelope === 0 ? '✅ ЧИСТО' : '🔴 ПРЕВЫШЕНИЕ';
    console.log(`${verdict}: поднятых нами точек над максимумом карты — ${v.raisedOverEnvelope} (порог 0)`);
    for (const r of v.overPoints) {
      console.log(`    #${r.i} ${r.mv} мВ: предложение ${r.offer} при сдвиге +${r.off} — на ${r.offer - card.maxMhz} МГц выше`);
    }
    console.log('');
    console.log('⚠️  ЧЕГО ЭТА ПРОБА НЕ ГОВОРИТ: взведён ли замок-граница. `nvidia-smi` поля «я под');
    console.log('    замком» не публикует вовсе (`profile-manager.mjs` → factoryStateVerdict), а при');
    console.log('    границе 180…3090 проверка «частота внутри диапазона» истинна всегда. Замок');
    console.log('    наблюдается только под нагрузкой (`plans/83` Ш4).');

    const out = path.join(ROOT, 'runs', 'probe-offer.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      what: 'Проба предложения карты против её максимума (P83-AC6). ТОЛЬКО ЧТЕНИЕ.',
      at: new Date().toISOString(),
      card,
      raisedCount: v.raisedCount,
      raisedOverEnvelope: v.raisedOverEnvelope,
      highestRaisedOfferMhz: v.highestRaisedOfferMhz,
      highestOfferedAnyMhz: v.highestOfferedAnyMhz,
      points: v.rows,
    }, null, 1) + '\n');
    console.log('');
    console.log(`улика: ${path.relative(ROOT, out)}`);
    return v.raisedOverEnvelope === 0 ? 0 : 1;
  } finally {
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
}

// CLI ИСПОЛНЯЕТСЯ ТОЛЬКО ПРИ ПРЯМОМ ЗАПУСКЕ — класс `bugs/95` («приборы исполняют CLI при импорте»)
// закрывается на входе, а не дописывается в его опись.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
