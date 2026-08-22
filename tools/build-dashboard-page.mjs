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
    <!-- ЖИВОЙ ЗНАК — три кольца, принят владельцем на стенде звука 2026-08-22 («анимация возле
         "идёт стресс тест" — шикарная, забираем её в наш визуализатор»). Крутится ВСЕГДА и ни от
         чего не зависит: он про то, что живы машина и окно. Когда прогон встаёт, кольца
         останавливаются и начинает медленно пульсировать красная лампа — движение не прекращается,
         меняется его ВИД (слово владельца там же). -->
    <div class="livewrap">
      <div class="livemark"><i></i><i></i><i></i><span class="lamp"></span></div>
      <div style="flex:1">
        <p class="state alive" id="state-alive">● ПОДЪЁМ ПРОГОНА</p>
        <p class="state dead" id="state-dead">■ ЗАМЕРЛО</p>
      </div>
    </div>
    <div class="m"><span>частота под тестом</span><b id="f-freq">—</b></div>
    <!-- «ПРОЙДЕНО по диапазону частот» СНЯТО как ложь: подпись обещала пройденное, а значение
         показывало ЗАКАЗАННУЮ полосу — владелец поймал это на первой же репетиции («врет. мы еще не
         дошли до 2157»). Подпись теперь называет ровно то, что под ней стоит; где идёт фронт —
         видно по плитке «частота под тестом» прямо над ней.
         ПОДНЯТА НА ВТОРОЕ МЕСТО словом владельца 2026-08-22 — рядом с фронтом, потому что «где мы»
         и «сколько всего» читаются одним взглядом или не читаются вовсе. Строка с долей пройденного
         УБРАНА тем же словом: осталось «настроено частот», число, которое не надо ни с чем сверять. -->
    <div class="m"><span>диапазон прогона</span><b id="f-band">—</b>
      <span id="f-cov" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span></div>
    <!-- «4 из 24» убрано словом владельца: номер ступени внутри спуска не говорит оператору ничего.
         Говорит ГЛУБИНА — сколько уже снято от заводского напряжения. А ШАГ (слово владельца
         2026-08-22) говорит, чем именно сюда спустились: «величина напряжения, которой спустились
         от высшего к текущему напряжению, последний выполненный шаг». Глубина отвечает «где мы»,
         шаг — «насколько крупно мы идём», и на краю это разные вопросы. -->
    <div class="m"><span>напряжение</span><b id="f-volt">—</b>
      <span id="f-depth" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span>
      <span id="f-step" style="text-transform:none;letter-spacing:0;font-size:13px;color:#c9d3df"></span></div>
    <!-- «прожиг» — жаргон (слово владельца 2026-08-16). На самом деле идёт СТРЕСС-ТЕСТ
         УСТОЙЧИВОСТИ, так и называем — здесь и во всём, что он читает. -->
    <div class="m"><span>стресс-тест устойчивости</span><b id="f-probe">—</b></div>
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
        font-size:11px;font-weight:700;letter-spacing:.12em}
  /* ЖИВОЙ ЗНАК. Собственные имена классов, чтобы не пересечься с .spin/.arm/.rock макета; на
     @keyframes spin макета опираемся намеренно — оно там уже есть и определено ровно так же. */
  .livewrap{display:flex;align-items:center;gap:14px;margin:0 0 12px}
  .livemark{width:52px;height:52px;position:relative;flex:0 0 auto}
  .livemark i{position:absolute;inset:0;border-radius:50%;border:2px solid transparent;
              border-top-color:var(--ok);border-right-color:rgba(63,185,80,.32);
              animation:spin 2.4s linear infinite}
  .livemark i:nth-child(2){inset:9px;border-top-color:var(--fire);
              border-right-color:rgba(255,122,60,.3);animation-duration:1.6s;animation-direction:reverse}
  .livemark i:nth-child(3){inset:18px;border-top-color:#e6edf3;animation-duration:3.4s}
  /* МЯГКИЙ КРАЙ, А НЕ РЕЗАНЫЙ КРУГ — слово владельца. Заливка идёт радиальным градиентом, который
     на внешней трети уходит в полную прозрачность: у лампы нет границы, есть свечение. Ровная
     заливка с border-radius давала именно «наклейку», о которой он и сказал. */
  .livemark .lamp{position:absolute;inset:6px;border-radius:50%;opacity:0;transition:opacity .5s;
                  background:radial-gradient(circle closest-side,
                             rgba(248,81,73,1) 0%, rgba(248,81,73,.92) 38%,
                             rgba(248,81,73,.45) 66%, rgba(248,81,73,.12) 84%, rgba(248,81,73,0) 100%)}
  /* ПРОГОН ВСТАЛ. Кольца ВСТАЮТ — но знак не замирает: лампа продолжает мигать, и это она
     доказывает, что жива машина. Замри знак целиком, и «прогон встал» слилось бы с «окно умерло».
     Облик задан владельцем 2026-08-22: «убери радиоволны, только лампочку оставь, сделай её
     больше, окружи застывшими секторами колец в разнобой расставленными, и медленнее мерцай в два
     раза». Поэтому: свечения нет вовсе, лампа крупнее (inset 11 против 18), кольца замирают на
     РАЗНЫХ углах, период 4,4 с вместо 2,2. */
  body.hung .livemark i{animation:none;border-color:transparent;border-top-color:#6b3330}
  body.hung .livemark i:nth-child(1){transform:rotate(22deg);border-right-color:#4a2422}
  body.hung .livemark i:nth-child(2){transform:rotate(196deg)}
  body.hung .livemark i:nth-child(3){transform:rotate(107deg);border-right-color:#4a2422}
  body.hung .livemark .lamp{opacity:1;animation:kagolamp 7s ease-in-out infinite}
  @keyframes kagolamp{ 0%,100%{opacity:.14} 50%{opacity:1} }`);

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

// ---- 3d. УПРАВЛЕНИЕ ВИЗУАЛИЗАТОРОМ — ОДНА КНОПКА В УГЛУ, слово владельца 2026-08-22 (вторая редакция).
//
// Первая редакция вынесла в шапку четыре органа подряд — кнопку, список тем, флажок и надпись хода.
// Владелец, посмотрев на живой прогон, свёл их в один: «всё управление звука нужно поместить в меню,
// которое одной кнопкой сведено в том углу… Кликом меню как drop-down меню раскрывается и там
// управление визуализатором, в частности, раздел звука».
//
// «В ЧАСТНОСТИ» — это указание на устройство, а не оборот речи: меню задумано как место для ВСЕГО
// управления окном, где звук — лишь первый раздел. Поэтому разметка несёт заголовок секции, а не
// плоский список: следующий раздел (например, переключатель языка, `ideas/07`) встаёт рядом, ничего
// не переписывая.
//
// Идентификаторы органов НЕ МЕНЯЮТСЯ (`snd-btn`, `snd-theme`, `snd-work`, `snd-move`) — переехала
// только их оправа. Проводка звука и стенд прослушивания продолжают работать без единой правки, и
// это осознанно: переезд облика не должен ничего стоить логике.
{
  const head = '  <span class="what" id="head-what">Выполняется автоматический тюнинг-прогон видеокарты</span>';
  must(s.includes(head), 'подпись шапки не найдена после переименования');
  s = s.replace(head, `${head}
  <div class="vizmenu">
    <button id="viz-btn" class="vizbtn" type="button" aria-haspopup="true" aria-expanded="false"
            title="управление визуализатором"><span class="dot" id="viz-dot"></span><span>МЕНЮ</span><span class="chev">▾</span></button>
    <div class="vizpop" id="viz-pop" hidden>
      <div class="vizsec">ЗВУК</div>
      <button id="snd-btn" class="sndbtn" type="button"><span class="dot"></span><span id="snd-lbl">ЗВУК ВЫКЛ</span></button>
      <select id="snd-theme" title="музыкальная тема">
        <option value="3">Тема: Глубокий космос</option>
        <option value="0">Тема: Маяк</option>
        <option value="1">Тема: Дрейф</option>
        <option value="2">Тема: Позывной</option>
        <option value="-1">Тема: выкл</option>
      </select>
      <label class="sndchk"><input type="checkbox" id="snd-work" checked> рабочие звуки</label>
      <span class="sndmove" id="snd-move"></span>
    </div><!-- /viz-pop -->
  </div>`);

  const anchor = '  .livewrap{display:flex;align-items:center;gap:14px;margin:0 0 12px}';
  must(s.includes(anchor), 'якорь стилей живого знака не найден');
  s = s.replace(anchor, `${anchor}
  /* МЕНЮ ВИЗУАЛИЗАТОРА. \`margin-left:auto\` уносит его в правый угол шапки, ничего не сдвигая:
     композиция макета, принятая владельцем, не тронута. \`position:relative\` — якорь для выпадения,
     чтобы список не толкал шапку, когда раскрыт. */
  .vizmenu{margin-left:auto;position:relative}
  .vizbtn{font:inherit;font-size:13px;font-weight:600;border-radius:8px;cursor:pointer;
        border:1px solid #232c38;background:#1c242e;color:#e6edf3;padding:7px 11px;
        display:inline-flex;align-items:center;gap:8px}
  .vizbtn .dot{width:9px;height:9px;border-radius:50%;background:#8b98a5}
  .vizbtn.on{border-color:var(--ok);color:#c7f0cd}
  .vizbtn.on .dot{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .vizbtn .chev{font-size:11px;color:#8b98a5}
  .vizbtn[aria-expanded="true"] .chev{transform:rotate(180deg)}
  /* Выпадение прижато правым краем к кнопке: она у самого угла окна, и раскрытие влево — */
  /* единственное направление, в котором меню целиком помещается на экран. */
  .vizpop{position:absolute;top:calc(100% + 8px);right:0;z-index:30;min-width:232px;
        display:flex;flex-direction:column;gap:9px;padding:12px;border-radius:12px;
        border:1px solid #232c38;background:#161d26;box-shadow:0 14px 34px rgba(0,0,0,.5)}
  .vizpop[hidden]{display:none}
  .vizsec{font-size:11px;font-weight:700;letter-spacing:.12em;color:#8b98a5}
  .vizpop select,.vizpop button,.vizpop label{font:inherit;font-size:13px;border-radius:8px;
        border:1px solid #232c38;background:#1c242e;color:#e6edf3;padding:7px 11px}
  .vizpop select{cursor:pointer}
  .vizpop .sndchk{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none}
  .vizpop .sndchk input{accent-color:var(--fire);cursor:pointer}
  .sndbtn{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:600}
  .sndbtn .dot{width:9px;height:9px;border-radius:50%;background:#8b98a5}
  .sndbtn.on{border-color:var(--ok);color:#c7f0cd}
  .sndbtn.on .dot{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .sndmove{font-size:12px;color:#8b98a5;min-height:16px}`);
}

// ---- 3e. ЗВУКОВОЙ ДВИЖОК встраивается ПЕРЕД проводкой: она на него ссылается.
{
  let sound = readFileSync(join('assets', 'dashboard', '_sound.js'), 'utf8');
  // ЗАПИСАННАЯ ТЕМА ЕДЕТ С НАШЕГО СЕРВЕРА — ровно по той же причине, что шрифт и логотип: у окна
  // прогона нет доступа к файлам мимо своего origin, а относительный путь в движке верен для
  // СТЕНДА, который открывают файлом. Одна правда о пути, две её формы, и обе делает сборщик.
  const trackRel = '../assets/dashboard/themes/deep-space.mp3';
  must(sound.includes(trackRel), 'в движке нет пути к записанной теме — переименовали файл?');
  sound = sound.replace(trackRel, '/theme.mp3');
  must(existsSync(join('assets', 'dashboard', 'themes', 'deep-space.mp3')),
    'файла записанной темы нет на диске — страница получит меню с немой первой темой');
  must(s.includes('</body>'), 'нет закрывающего body для движка звука');
  s = s.replace('</body>', `<script>\n${sound}</script>\n</body>`);
}

// ---- 4. the wiring
const js = readFileSync(WIRING, 'utf8');
must(s.includes('</body>'), 'нет закрывающего body');
s = s.replace('</body>', `<script>\n${js}</script>\n</body>`);

// ---- 4b. `--check`: СТОРОЖ СВЕЖЕСТИ СБОРКИ. Собирает в память и сверяет с тем, что лежит на диске.
//
// ЧТО ОН ЛОВИТ И ЧЕМ ЗА НЕГО ЗАПЛАЧЕНО (2026-08-22 21:2x, вторая жалоба владельца на одно и то же):
// умолчание темы звука починили в `_sound.js` и `_wiring.js` в 20:55, а `sweep.html` — то, что окно
// РЕАЛЬНО отдаёт браузеру — собран в 17:55 и остался с прежним `melIdx = 0`, то есть «Маяк». Правка
// легла в правду, а работало зеркало; ничего при этом не покраснело, потому что сверять было нечем.
// Правило канона существовало («генерируемую поверхность правят в источнике и пересобирают»), но
// правило, за которым не следит машина, исполняется ровно до первой спешки.
//
// ПОЧЕМУ СВЕРКА ПО СОДЕРЖИМОМУ, А НЕ ПО ВРЕМЕНИ ФАЙЛА: `git` не хранит mtime, поэтому на свежем
// клоне любая проверка «страница новее источников» соврала бы в обе стороны. Сборка детерминирована
// (чистые строковые замены), значит честная мера свежести — байты.
//
// ПЕРЕВОДЫ СТРОК НОРМАЛИЗУЮТСЯ, И ЭТО НЕ ПОСЛАБЛЕНИЕ: у репозитория `core.autocrlf = true`, то есть
// рабочая копия получает CRLF, а сборщик пишет LF. Без нормализации сторож краснел бы на КАЖДОМ
// свежем клоне — по своей причине, а не по дефекту, и его первым делом научились бы объяснять
// (стоп-линия 6 рельсов: сторож, которому нашли оправдание, — сторож, который не сработал).
if (process.argv.includes('--check')) {
  const norm = (t) => t.replace(/\r\n/g, '\n');
  if (!existsSync(DST)) {
    console.error(`ОСТАНОВ: страницы ${DST} нет на диске — соберите: node tools/build-dashboard-page.mjs`);
    process.exit(1);
  }
  if (norm(readFileSync(DST, 'utf8')) !== norm(s)) {
    console.error(`ОСТАНОВ: ${DST} НЕ СООТВЕТСТВУЕТ своим источникам — окно отдаёт устаревшую сборку.`);
    console.error(`         источники: ${SRC} · ${WIRING} · assets/dashboard/_sound.js`);
    console.error('         ЧТО СДЕЛАТЬ: node tools/build-dashboard-page.mjs — и закоммитить страницу вместе с правкой источника.');
    process.exit(1);
  }
  console.log(`ОК: ${DST} собрана из текущих источников`);
  process.exit(0);
}

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
    .replace('src="/logo.webp"', 'src="../logo/kago-logo.webp"')
    // Превью лежит в `assets/dashboard/`, поэтому запись у него под боком, без ведущей косой.
    .replace("'/theme.mp3'", "'themes/deep-space.mp3'");
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
