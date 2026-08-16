/* ==================================================================================================
   ЖИВОЙ ПРОГОН — проводка страницы (`plans/20` §4.4, из `ideas/06`)
   ==================================================================================================

   🔴 ГЛАВНОЕ ЗДЕСЬ ОДНО, И ОНО НЕ ПРО КРАСОТУ: анимация, которая крутится от СВОЕГО таймера, — лжец.
   Она будет бодро махать, когда прогон уже мёртв, а машина жива (убитый драйвер, TDR, упавший
   процесс) — и оператор будет ждать того, чего не будет. Поэтому фаза анимации здесь — ФУНКЦИЯ
   ПОСЛЕДНЕГО ПУЛЬСА: ключевые кадры, принятые владельцем, ставятся на паузу, а время им выдаёт
   пришедшая с прогона отметка `runMs`.

   ЧЕСТНАЯ ЦЕНА, НАЗВАННАЯ ВСЛУХ: пульс приходит примерно раз в секунду, а глаз ловит рывки, поэтому
   между пульсами время ЭКСТРАПОЛИРУЕТСЯ — но не дальше поводка ниже. То есть после смерти прогона
   картинка живёт ещё максимум `LEASH_MS`, и это её предел; дальше она стоит намертво, а через
   `FREEZE_MS` зажигается тревога. Никакого «а вдруг ещё придёт» здесь нет.
   ================================================================================================== */

const FREEZE_MS = 3000;   // столько без пульса — и это уже тревога, а не задержка
const LEASH_MS  = 1500;   // насколько анимации разрешено уехать вперёд последнего пульса

const $ = (id) => document.getElementById(id);
const fmt = (v, unit, digits = 0) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits).replace('.', ',')} ${unit}`);
const hms = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p2 = (n) => String(n).padStart(2, '0');
  return `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}`;
};
const seg = (id, v, width) => {
  const el = $(id);
  if (!el) return;
  el.textContent = (v === null || v === undefined) ? '-'.repeat(width) : String(Math.round(v));
};

let pulse = null;         // последний пришедший пульс
let pulseAt = 0;          // когда он пришёл, по часам БРАУЗЕРА (часы прогона могли встать)
let anims = [];

/* Принятые ключевые кадры остаются ровно теми же — мы только отбираем у них собственные часы. */
function seizeAnimations() {
  anims = [...document.querySelectorAll('.spin,.arm,.rock')].flatMap((el) => el.getAnimations());
  anims.forEach((a) => a.pause());
}

function paint() {
  if (!pulse) return;
  const r = pulse.run || {};
  const c = pulse.card || {};

  $('f-freq').textContent = r.frequencyMhz ? `${r.frequencyMhz} МГц` : '—';
  $('f-volt').textContent = r.voltageMv ? `${r.voltageMv} мВ` : '—';
  $('f-depth').innerHTML = (r.stockVoltageMv && r.depthMv !== null && r.depthMv !== undefined)
    ? `сток ${r.stockVoltageMv} · андервольт <b style="display:inline;font-size:13px;color:var(--ok)">−${r.depthMv} мВ</b>`
    : '';
  const p = r.probe || {};
  $('f-probe').innerHTML = `${(p.elapsedSeconds ?? 0).toFixed(1).replace('.', ',')} `
    + `<span style="font-size:17px;color:var(--dim)">из ${p.totalSeconds ?? 10} с</span>`;
  $('f-band').textContent = r.band || '—';
  const cov = r.coverage || {};
  // «Ступеней пройдено» УБРАНО словом владельца: ступень спуска по напряжению — внутренняя единица
  // движка, и оператору она не говорит ничего, ровно как убранная раньше «ступень N из M».
  // Осталось то, что говорит: сколько частот диапазона уже настроено.
  // ГДЕ ИДЁТ ФРОНТ — первое, что спросил владелец, глядя на прогон. Спуск идёт СВЕРХУ ВНИЗ (его
  // алгоритм, ideas/03 §6), поэтому положение — это доля пройденного пути от верхней частоты к нижней.
  const front = r.frequencyMhz;
  let walked = '';
  if (front && r.bandFromMhz && r.bandToMhz && r.bandFromMhz > r.bandToMhz) {
    const pct = Math.round(100 * (r.bandFromMhz - front) / (r.bandFromMhz - r.bandToMhz));
    walked = `<span style="white-space:nowrap">спустились до <b style="display:inline;font-size:13px">${front} МГц</b> — это ${pct} % пути</span><br>`;
  }
  $('f-cov').innerHTML = cov.total
    ? walked + `<span style="white-space:nowrap">настроено частот <b style="display:inline;font-size:13px">${cov.closed ?? 0} из ${cov.total}</b></span>`
    : walked;

  seg('seg-clk', c.clockMhz, 4);
  seg('seg-temp', c.tempC, 2);
  seg('seg-fan', c.fanPct, 2);
  seg('seg-pwr', c.powerW, 3);
  $('synthetic-note').style.display = c.synthetic ? 'inline-block' : 'none';

  // ДВОЕ ЧАСОВ. Таймер прогона идёт ОТ ПУЛЬСА — значит замирает вместе с прогоном и показывает,
  // на какой секунде тот встал; стенные часы идут сами. Их расхождение и есть «давно ли встало».
  $('c-elapsed').textContent = hms(pulse.runMs);

  $('state-alive').textContent = `● ${r.state || 'ПРОГОН'}`;
  document.title = r.finished
    ? 'KAGO — прогон завершён'
    : 'KAGO — Выполняется автоматический тюнинг-прогон видеокарты';
}

/* Кадр. Всё, что здесь считается, считается ОТ ПУЛЬСА. */
function frame() {
  requestAnimationFrame(frame);
  if (!pulse) return;
  const since = performance.now() - pulseAt;

  // Прогон, который ЗАКОНЧИЛСЯ, не должен выглядеть зависшим — иначе тревога обесценится в первый же
  // штатный финал, и оператор перестанет ей верить.
  // СКОЛЬКО МОЛЧАНИЯ СЕЙЧАС НОРМАЛЬНО — говорит САМ ПРОГОН, а не гадает страница.
  //
  // Он блокируется на время стресс-теста: нагрузка запускается синхронно, и десять секунд из процесса
  // не выходит НИЧЕГО — ни по SSE, ни по сокету, потому что стоит цикл событий, а не транспорт.
  // Со старым фиксированным терпением в 3 с тревога загоралась НА КАЖДОЙ ступени, все 68 раз за
  // прогон. Тревога, которая врёт по расписанию, отменяет сама себя — и настоящее зависание,
  // ради которого она заведена, оператор уже не отличит.
  //
  // Поэтому прогон перед прожигом объявляет свой бюджет молчания (`quietMs`), и страница судит по
  // нему. Молчание В ПРЕДЕЛАХ объявленного — это прожиг, и так и написано. Молчание СВЕРХ него —
  // это зависание, и написано будет это. Оба утверждения правдивы.
  const quiet = Number(pulse.quietMs) > 0 ? Number(pulse.quietMs) : FREEZE_MS;
  const frozen = !pulse.run.finished && since > quiet;
  document.body.classList.toggle('hung', frozen);
  const r = pulse.run;
  if (frozen) {
    // ПЕРЕБРАЛ СВОЙ ЖЕ БЮДЖЕТ. Насколько именно — на экране: «встало 4 секунды назад» и «встало три
    // минуты назад» требуют от оператора разных действий.
    $('state-dead').textContent = r.frequencyMhz
      ? `■ ЗАМЕРЛО на ${((since - quiet) / 1000).toFixed(0)} с сверх ожидаемого — ${r.frequencyMhz} МГц / ${r.voltageMv ?? '?'} мВ`
      : '■ ЗАМЕРЛО';
  } else if (!r.finished && quiet > FREEZE_MS) {
    // ИДЁТ ПРОЖИГ, и это ЖИВОЕ состояние. Секунда считается от последнего пульса — то есть от того
    // мгновения, когда прогон объявил, что уходит в тишину, — а не выдумывается.
    const sec = Math.min(since / 1000, r.probe?.totalSeconds ?? 10);
    $('state-alive').textContent = `● ${r.state || 'ПРОГОН'} — ${sec.toFixed(0)} с из ${r.probe?.totalSeconds ?? 10}`;
  }

  const t = pulse.runMs + Math.min(since, LEASH_MS);
  for (const a of anims) {
    try { a.currentTime = t; } catch (e) { /* анимация ушла — не за что держаться */ }
  }
}

function connect() {
  const es = new EventSource('/live');
  es.onmessage = (m) => {
    try { pulse = JSON.parse(m.data); } catch (e) { return; }
    pulseAt = performance.now();
    paint();
  };
  // Разрыв — это НЕ «всё хорошо»: сервер мог умереть вместе с машиной. Ничего не сбрасываем,
  // не рисуем ложного спокойствия — молчание само зажжёт тревогу через FREEZE_MS.
  es.onerror = () => {};
}

/* Стенные часы браузера — единственное на этой странице, что НЕ приходит с прогона, и это
   намеренно: они обязаны идти, когда всё остальное встало. */
function wallClock() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  $('c-now').textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
wallClock();
setInterval(wallClock, 1000);

seizeAnimations();
requestAnimationFrame(frame);
connect();
