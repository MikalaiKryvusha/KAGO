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
 * [NOT-TESTED] — собственного набора самопроверок у прибора ПОКА НЕТ, и это названный долг, а не
 * умолчание. Наблюдён живьём один раз: 2026-09-01 18:0x, карта в `optimised`, 54 °C, через 7,5 ч
 * после записи 10:36:35 — 0 поднятых точек над максимумом, плато 3067 МГц. Арифметика проверена
 * ТРЕТЬИМ независимым чтением: живой вектор сошёлся с инверсией документа кривой точка в точку на
 * 51 точке из 51, где документ говорит (разбор — `plans/83` Ш6).
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

function main() {
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
  process.exit(main());
}
