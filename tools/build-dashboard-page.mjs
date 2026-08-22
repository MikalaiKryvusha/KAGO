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

// ---- 1b. THE HEADLINE GETS A NAME, because in the mockup it is a caption and on the live page it is
// a CLAIM. It reads «Выполняется автоматический тюнинг-прогон видеокарты» — and the owner opened the
// window between runs and saw exactly that sentence above a panel saying «ПРОГОНА НЕТ»
// («опять в сломанном состоянии всё поднялось», 2026-08-16). One screen, two contradicting statements,
// and the big one at the top is the one a glance lands on first.
//
// The mockup is not edited: it is a mockup, and there the sentence is true by assumption. What the
// live page needs is the ability to CHANGE it, so the wiring gets a handle.
{
  const cap = '<span class="what">Выполняется автоматический тюнинг-прогон видеокарты</span>';
  must(s.includes(cap), 'подпись шапки не найдена в макете');
  s = s.replace(cap, '<span class="what" id="head-what">Выполняется автоматический тюнинг-прогон видеокарты</span>');
}

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
    <!-- «ПРОЙДЕНО по диапазону частот» СНЯТО как ложь: подпись обещала пройденное, а значение
         показывало ЗАКАЗАННУЮ полосу — владелец поймал это на первой же репетиции («врет. мы еще не
         дошли до 2157»). Подпись теперь называет ровно то, что под ней стоит; пройденное считает
         строка ниже, а где идёт фронт — видно по верхней плитке «частота под тестом». -->
    <div class="m"><span>диапазон прогона</span><b id="f-band">—</b>
      <span id="f-cov" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span></div>
    <!-- ДВОЕ ЧАСОВ, попрошены владельцем на первом полном прогоне. Они нарочно идут от РАЗНЫХ
         часов, и эта пара стоит больше любой своей половины: таймер прогона идёт ОТ ПУЛЬСА и
         замирает вместе с ним, стенные часы идут сами. Расстояние между ними — это «давно ли
         встало», число, которое иначе оператор в три часа ночи вычисляет по памяти. -->
    <div class="m clocks">
      <div><span>время прогона</span><b id="c-elapsed">0:00:00</b></div>
      <div><span>время локальное</span><b id="c-now">--:--:--</b></div>
    </div>`;
s = s.slice(0, i0) + column + s.slice(i1 + to.length);

// The two clocks live in a tile of their own, and the «ВИРТУАЛЬНАЯ» pill needs the stage to be a
// positioning context. Both styles are appended to the mockup's own rule rather than overriding it.
const TILE_STYLE = '.m span{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em}';
must(s.includes(TILE_STYLE), 'стиль плиток не найден');
s = s.replace(TILE_STYLE, `${TILE_STYLE}
  .m.clocks{display:flex;gap:18px}
  .m.clocks>div{flex:1}
  .m.clocks b{font-size:24px}
  .stage{position:relative}
  /* Пилюля «ВИРТУАЛЬНАЯ» — вверху справа НА виджете видеокарты, место выбрал владелец. Огненный
     цвет бренда: заметно, но это не тревога — карта не сломана, она ненастоящая. */
  .pill{position:absolute;top:12px;right:14px;z-index:2;padding:4px 12px;border-radius:999px;
        border:1px solid var(--fire);color:var(--fire);background:rgba(255,122,60,.10);
        font-size:11px;font-weight:700;letter-spacing:.12em}`);

// The state line is now the column's first element, so its top margin has to go — the mockup's
// `margin:14px 0 0` was spacing it away from the tile ABOVE it, and there is no tile above it now.
must(s.includes('.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:14px 0 0}'), 'стиль .state не найден');
s = s.replace('.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:14px 0 0}',
  '.state{font-weight:700;letter-spacing:.02em;font-size:17px;margin:0 0 12px}');

// ---- 3b. THE «ВИРТУАЛЬНАЯ» PILL, on the card widget itself — the owner's placement.
//
// It replaces a three-line explanation, and it is better than the paragraph in the way that matters:
// a caption under a picture is read once, a badge ON the thing is read every time the eye lands on
// it. What must never be lost is the fact itself — a reading whose origin the operator does not know
// will eventually be quoted as a measurement of the owner's card.
must(s.includes('<div class="stage">'), 'сцена не найдена');
s = s.replace('<div class="stage">',
  '<div class="stage"><span class="pill" id="synthetic-note" style="display:none">ВИРТУАЛЬНАЯ</span>');

// ---- 3c. THE LAST ENGINEERED DEATH IS REMOVED — the owner's word, 2026-08-22.
//
// The mockup pauses the accepted keyframes whenever the page goes into its `hung` state. That is the
// same «dying mechanism» he banned in the wiring, one layer down in CSS:
//
//   «НИКАКОГО УМИРАНИЯ ВМЕСТЕ С ЧЕМ-ТО. НИ АНИМАЦИИ НИ ЗВУКА. ВСЁ ВОСПРОИЗВОДИТСЯ ВСЕГДА.»
//   «оно само зависнет, когда зависнет комп — не нужно никаких специальных механизмов умирания»
//
// The mockup itself is NOT edited — it is the accepted drawing, and there the paused state is a
// legitimate way to DEPICT a hang in a still picture. On the live page it is a mechanism, and the
// mechanism is what he removed. `body.hung` stays alive for everything else it does: it swaps the
// green state line for the red one, i.e. the page keeps SAYING the run stalled — in words, which is
// the half of the rule that must not be lost.
{
  const paused = 'body.hung .spin,body.hung .arm,body.hung .rock{animation-play-state:paused!important}';
  must(s.includes(paused), 'правило паузы кадров не найдено в макете');
  s = s.replace(paused, '/* пауза кадров снята словом владельца 2026-08-22 — кадры идут ВСЕГДА */');
}

// ---- 4. the wiring
const js = readFileSync(WIRING, 'utf8');
must(s.includes('</body>'), 'нет закрывающего body');
s = s.replace('</body>', `<script>\n${js}</script>\n</body>`);

if (!existsSync('assets/dashboard')) mkdirSync('assets/dashboard', { recursive: true });
writeFileSync(DST, s, 'utf8');
console.log(`СОБРАНО: ${DST}, ${s.length} байт (из ${SRC} — принятого макета)`);

// ---- 5. `--preview`: a STATIC copy for looking at the page with one's own eyes.
//
// It exists because a headless screenshot of the LIVE page never completes — the page holds an open
// SSE connection, so the browser is never «done loading» and `--screenshot` never fires. The preview
// swaps that connection for ONE pulse taken off a real run and makes the asset URLs relative, which
// is what lets a `file://` render work at all. Markup, CSS and keyframes are untouched.
//
// A render is accepted by LOOKING, never by reading the code that produced it (EXP-0046) — so this is
// the check, not a convenience. The output is a run artefact and stays out of history.
if (process.argv.includes('--preview')) {
  const pulsePath = join('runs', 'dashboard', 'live.json');
  must(existsSync(pulsePath), `нет пульса ${pulsePath} — сперва прогон: npm run bench -- --from 2842 --to 2820`);
  const pulse = readFileSync(pulsePath, 'utf8');
  let prev = s
    .replace('src:url(/font.woff2)', 'src:url(../fonts/DSEG7Classic-Regular.woff2)')
    .replace('src="/logo.webp"', 'src="../logo/kago-logo.webp"');
  must(prev.includes('connect();'), 'в проводке нет вызова connect()');
  // `--no-pill` снимает метку «ВИРТУАЛЬНАЯ» — снимок для README показывает ИНСТРУМЕНТ, а он один и
  // тот же на стенде и на живой карте (слово владельца 2026-08-16 04:1x). Числа при этом остаются
  // теми, что были в прогоне: подпись под картинкой говорит, откуда они, а сама картинка не
  // изображает замер живой карты.
  const noPill = process.argv.includes('--no-pill');
  // Пульс НЕ обновляется в статике, поэтому детектор зависания зажёгся бы через три секунды и
  // снимок вышел бы с тревогой. Здесь это ложь о картинке, а не о прогоне: держим метку времени
  // свежей ровно для рендера.
  // Ленты в статике нет вовсе, а страница теперь честно называет её отсутствие («нет связи») —
  // `bugs/27`. Для рендера подставляется ЗАГЛУШКА ленты в состоянии OPEN: back door в боевой код
  // ради снимка не заводится, подменяется только то, чего в файле физически нет.
  prev = prev.replace('connect();',
    `es = { readyState: 1 }; pulse = ${pulse}; ${noPill ? 'pulse.card.synthetic = false; ' : ''}pulseAt = performance.now(); paint();\n`
    + '  setInterval(() => { pulseAt = performance.now(); }, 200);');
  const out = join('assets', 'dashboard', '_preview.html');
  writeFileSync(out, prev, 'utf8');
  console.log(`ПРЕВЬЮ:  ${out} — впрыснут пульс seq=${JSON.parse(pulse).seq}. Снять картинку:`);
  console.log(`         msedge --headless=new --disable-gpu --window-size=1200,860 --virtual-time-budget=4000 \\`);
  console.log(`           "--screenshot=<абсолютный путь>.png" "file:///${process.cwd().replace(/\\/g, '/')}/${out.replace(/\\/g, '/')}"`);
}
