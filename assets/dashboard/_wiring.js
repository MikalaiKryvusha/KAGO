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
      + (r.seeded ? ' · спуск от соседки' : '')
    : '';
  const p = r.probe || {};
  $('f-probe').innerHTML = `${(p.elapsedSeconds ?? 0).toFixed(1).replace('.', ',')} `
    + `<span style="font-size:17px;color:var(--dim)">из ${p.totalSeconds ?? 10} с</span>`;
  $('f-band').textContent = r.band || '—';
  const cov = r.coverage || {};
  $('f-cov').innerHTML = cov.total
    ? `настроено частот <b style="display:inline;font-size:13px">${cov.closed ?? 0} из ${cov.total}</b>`
      + ` · ступеней пройдено <b style="display:inline;font-size:13px">${cov.rungs ?? 0}</b>`
    : '';

  seg('seg-clk', c.clockMhz, 4);
  seg('seg-temp', c.tempC, 2);
  seg('seg-fan', c.fanPct, 2);
  seg('seg-pwr', c.powerW, 3);
  $('synthetic-note').style.display = c.synthetic ? 'block' : 'none';

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
  const frozen = !pulse.run.finished && since > FREEZE_MS;
  document.body.classList.toggle('hung', frozen);
  if (frozen) {
    const r = pulse.run;
    $('state-dead').textContent = r.frequencyMhz
      ? `■ ЗАМЕРЛО — ${r.frequencyMhz} МГц / ${r.voltageMv ?? '?'} мВ`
      : '■ ЗАМЕРЛО';
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

seizeAnimations();
requestAnimationFrame(frame);
connect();
