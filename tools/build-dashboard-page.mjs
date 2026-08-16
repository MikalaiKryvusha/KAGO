// =================================================================================================
// THE LIVE PAGE IS BUILT FROM THE ACCEPTED MOCKUP — never re-drawn by hand (`plans/20` §4.4)
// =================================================================================================
//
// WHY A BUILDER AND NOT A SECOND HTML FILE: the look was accepted by the owner in
// `homeworks/03_sweep_animation.html` («в остальном ОК, принято»), and a taste verdict is canon the
// agent does not reopen. Two copies of one picture is the truth↔mirror pair this project keeps paying
// for (R16c, EXP-0077): the day someone fixes the wrench in one file, the other quietly stops being
// what was accepted. So the mockup stays the ONLY drawing, and this script adds the wiring.
//
// WHAT IT CHANGES, AND NOTHING ELSE:
//   1. the font and the logo come from OUR OWN loopback server instead of a base64 blob / a relative
//      path — same origin, so the reason the mockup embedded them (no network during a run) holds;
//   2. the four seven-segment readouts and the tiles get names, so the wiring can bind to them;
//   3. the tiles are re-bound to the run's real data, and the RUN STATE moves to the TOP of the
//      column — the owner's instruction while watching the first rehearsal, 2026-08-16 03:2x:
//      «● ИДЁТ СТРЕСС-ТЕСТ — это в правой колонке над всеми виджетами поднять вверх нужно»;
//   4. `assets/dashboard/_wiring.js` is inlined before `</body>`.
//
// Run: `node tools/build-dashboard-page.mjs` → `assets/dashboard/sweep.html`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join('homeworks', '03_sweep_animation.html');
const DST = join('assets', 'dashboard', 'sweep.html');
const WIRING = join('assets', 'dashboard', '_wiring.js');

const must = (cond, why) => { if (!cond) { console.error('ОСТАНОВ: ' + why); process.exit(1); } };

let s = readFileSync(SRC, 'utf8');

// ---- 1. the font, from our own server
const before = s.length;
s = s.replace(/src:url\(data:font\/woff2;base64,[^)]*\)/, 'src:url(/font.woff2)');
must(s.length < before - 6000, 'шрифт не заменился на серверный');

must(s.includes('src="../assets/logo/kago-logo.webp"'), 'логотип не найден в макете');
s = s.replace('src="../assets/logo/kago-logo.webp"', 'src="/logo.webp"');

// ---- 2. the readouts get names; their «off» underlays stay exactly as accepted
for (const [x, id] of [['106', 'seg-clk'], ['185', 'seg-temp'], ['264', 'seg-fan'], ['343', 'seg-pwr']]) {
  const re = new RegExp(`<text class="seg on"(\\s+)x="${x}"`);
  must(re.test(s), `индикатор x=${x} не найден`);
  s = s.replace(re, `<text id="${id}" class="seg on"$1x="${x}"`);
}

// ---- 3. the right-hand column
const from = '    <div class="m"><span>частота под тестом</span><b>2842 МГц</b></div>';
const to = '    <p class="state dead">■ ЗАМЕРЛО — 2842 МГц / 995 мВ</p>';
const i0 = s.indexOf(from);
const i1 = s.indexOf(to);
must(i0 > 0 && i1 > i0, 'блок плиток не найден');

const column = `    <!-- СОСТОЯНИЕ ПРОГОНА СТОИТ ПЕРВЫМ — правка владельца по первой же репетиции. И она по
         существу: оператор не читает колонку, он БРОСАЕТ на неё взгляд, а первое, что ему нужно
         знать, — идёт прогон или встал. Цифры отвечают на второй вопрос, не на первый. -->
    <p class="state alive" id="state-alive">● ПОДЪЁМ ПРОГОНА</p>
    <p class="state dead" id="state-dead">■ ЗАМЕРЛО</p>
    <div class="m"><span>частота под тестом</span><b id="f-freq">—</b></div>
    <!-- «4 из 24» убрано словом владельца: номер ступени внутри спуска не говорит оператору ничего.
         Говорит ГЛУБИНА — сколько уже снято от заводского напряжения. -->
    <div class="m"><span>напряжение</span><b id="f-volt">—</b>
      <span id="f-depth" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span></div>
    <!-- «прожиг» — жаргон (слово владельца 2026-08-16). На самом деле идёт СТРЕСС-ТЕСТ
         УСТОЙЧИВОСТИ, так и называем — здесь и во всём, что он читает. -->
    <div class="m"><span>стресс-тест устойчивости</span><b id="f-probe">—</b></div>
    <div class="m"><span>пройдено по диапазону частот</span><b id="f-band">—</b>
      <span id="f-cov" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span></div>
    <!-- Показания карты — МОДЕЛЬ, и это сказано на экране, а не только в коде: число, про которое
         оператор не знает, откуда оно, он однажды процитирует как замер. -->
    <p id="synthetic-note" style="display:none;margin:14px 0 0;color:var(--dim);font-size:12px;line-height:1.45">
      Показания на карте — <b style="color:#c9d3df">СИНТЕТИКА</b> виртуальной карты: модель, посаженная
      на наши же измеренные строки тепловой лестницы. Ход прогона слева и справа — настоящий.</p>`;
s = s.slice(0, i0) + column + s.slice(i1 + to.length);

// The state line is now the column's first element, so its top margin has to go — the mockup's
// `margin:14px 0 0` was spacing it away from the tile ABOVE it, and there is no tile above it now.
must(s.includes('.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:14px 0 0}'), 'стиль .state не найден');
s = s.replace('.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:14px 0 0}',
  '.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:0 0 12px}');

// ---- 4. the wiring
const js = readFileSync(WIRING, 'utf8');
must(s.includes('</body>'), 'нет закрывающего body');
s = s.replace('</body>', `<script>\n${js}</script>\n</body>`);

if (!existsSync('assets/dashboard')) mkdirSync('assets/dashboard', { recursive: true });
writeFileSync(DST, s, 'utf8');
console.log(`СОБРАНО: ${DST}, ${s.length} байт (из ${SRC} — принятого макета)`);
