// ОПЫТ bugs/129: срабатывает ли предохранитель на НОРМАЛЬНОМ КОНЦЕ ПРОЖИГА сегодня.
//
// Что воспроизводится: 08.09 в 19:21 полоса дала 9 трипов, по одному на конец каждой ступени.
// Правило, их пропускавшее, снято в 19:44 (bugs/130) и с тех пор ЖИВЬЁМ НЕ ПРОВЕРЕНО.
//
// Опыт ставит ровно ту сцену и ничего больше: судья ВЗВЕДЁН по входу 2 с той же уставкой
// M = 1177 мс, проба ретранслирует прогресс, горн отрабатывает своё и КОНЧАЕТСЯ САМ.
// Ожидание: трипа нет. Трип есть — блокер полосы жив, и мы это знаем за 30 секунд, а не за вечер.
//
// Напряжение в карту НЕ пишется: судья взведён, но рука 2 пишет заводское значение только НА
// трипе, а карта и так заводская. Горн — обычная нагрузка на чтение.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/work/ai_sandbox/KAGO';
const OUT = path.join(process.env.TMP ?? '.', 'exp129');
mkdirSync(OUT, { recursive: true });
const journal = path.join(OUT, 'judge.jsonl');
const progress = path.join(OUT, 'burn-progress.txt');
const M = 1177;          // та же уставка входа 2, что стояла 08.09
const SUSTAIN = 8;       // ступень полосы 08.09 длилась 8,9 с — берём ту же длину
const SECONDS = 26;      // судья переживает конец прожига на 15+ секунд: трип ждём ИМЕННО после него

const judge = spawn(process.execPath, [
  path.join(ROOT, 'automation-engine/lib/fuse.mjs'), '--judge',
  '--arm-m', String(M), '--progress-file', progress,
  '--seconds', String(SECONDS), '--out', journal,
], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

let port = null;
let probe = null;
let burn = null;
judge.stdout.on('data', (b) => {
  const s = b.toString();
  process.stdout.write(`[СУДЬЯ] ${s}`);
  const m = s.match(/порт (\d+)/u);
  if (m && !port) {
    port = Number(m[1]);
    probe = spawn(process.execPath, [
      path.join(ROOT, 'automation-engine/lib/death-watch.mjs'), '--probe',
      '--port', String(port), '--seconds', String(SECONDS), '--progress-file', progress,
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    probe.stdout.on('data', (x) => process.stdout.write(`[ПРОБА] ${x}`));
    setTimeout(() => {
      burn = spawn(path.join(ROOT, 'workloads/furnace.exe'),
        ['2400', '8192', '256', '64', '--sustain', String(SUSTAIN), '--progress-file', progress],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(`[ОПЫТ] горн pid ${burn.pid} на ${SUSTAIN} с — и он ОБЯЗАН кончиться сам`);
      burn.on('exit', (c) => {
        console.log(`[ОПЫТ] горн кончился САМ, код ${c} · файл сердцебиения ${existsSync(progress) ? 'ОСТАЛСЯ' : 'снят самим горном'}`);
        console.log('[ОПЫТ] с этой секунды тишина прогресса растёт. Если предохранитель ложно сработает — это будет здесь.');
      });
    }, 3000);
  }
});
judge.stderr.on('data', (b) => process.stderr.write(`[СУДЬЯ!] ${b}`));

judge.on('exit', (code) => {
  try { probe?.kill(); } catch { /* ушла */ }
  try { burn?.kill(); } catch { /* ушёл */ }
  console.log(`\n[ОПЫТ] судья вышел с кодом ${code} (2 = БЫЛ ТРИП, 0 = трипа не было)`);
  const lines = existsSync(journal) ? readFileSync(journal, 'utf8').trim().split(/\r?\n/u).filter(Boolean) : [];
  const trips = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((x) => x && x.phase === 'intent');
  console.log(`[ОПЫТ] намерений трипа в протоколе: ${trips.length}`);
  for (const t of trips) console.log(`        ${t.at} · ${t.cause} · тишина ${t.progressSilenceMs} мс`);
  console.log(trips.length === 0
    ? '\n🟢 ВЫВОД: нормальный конец прожига БОЛЬШЕ НЕ ЧИТАЕТСЯ КАК СМЕРТЬ. Ложных стен этого класса полоса не изготовит.'
    : '\n🔴 ВЫВОД: ложное срабатывание ЖИВО — блокер полосы на месте, и это его подпись.');
});
