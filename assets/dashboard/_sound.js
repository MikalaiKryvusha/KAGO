/* ==================================================================================================
   ЗВУК ВИЗУАЛИЗАТОРА — второй канал обратной связи (`homeworks/04_dashboard_sound_taste.md`)
   ==================================================================================================

   Собран из принятого владельцем стенда прослушивания. Движок перенесён МЕХАНИЧЕСКИ, а не
   перепечатан: пятьсот строк, выверенных ухом, перепечатать — верный способ завезти расхождение
   между тем, что владелец слушал, и тем, что играет.

   🔴 ПРАВИЛО ВЛАДЕЛЬЦА 2026-08-22: «ВСЁ ВОСПРОИЗВОДИТСЯ ВСЕГДА. МНЕ ОНО НУЖНО ГАРАНТИРОВАНО
   ЖИВОЕ» · «оно само зависнет, когда зависнет комп — не нужно никаких специальных механизмов
   умирания разрабатывать». Поэтому звук НЕ обусловлен ходом прогона: он идёт, пока открыто окно и
   включён звук, и доказывает, что жива машина. Что встал прогон — говорят слова, цвет и остановка
   колец живого знака.

   ЧТО ВЫБРАЛ ВЛАДЕЛЕЦ (вердикты — `homeworks/04_dashboard_sound_taste.md`):
     · тема «Маяк» с ритмом по `researches/12`; в меню все три плюс «выключить»;
     · рабочие звуки дока — отдельным выключателем;
     · наложения 50 %, не больше трёх голосов сразу;
     · громкость максимальная, регулятора нет — на выходе лимитер.

   БРАУЗЕР НЕ ДАЁТ ЗВУЧАТЬ БЕЗ ДЕЙСТВИЯ ЧЕЛОВЕКА, поэтому кнопка звука — не украшение, а
   разрешение: до первого щелчка `AudioContext` не создаётся вовсе.
   ================================================================================================== */

const KagoSound = (() => {
  let ac = null, master = null, blipBus = null, melBus = null, padBus = null, verb = null;
  let armed = false, soundOn = false, workOn = true;

  const now = () => ac.currentTime;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  const N = {
    A1: 55.00, E2: 82.41, Fs2: 92.50, A2: 110.00, B2: 123.47, Cs3: 138.59, D3: 146.83, E3: 164.81,
    Fs3: 185.00, A3: 220.00, B3: 246.94, Cs4: 277.18, D4: 293.66, E4: 329.63, Fs4: 369.99,
    A4: 440.00, B4: 493.88, Cs5: 554.37, E5: 659.25, Fs5: 739.99, A5: 880.00, B5: 987.77,
    Cs6: 1108.73, E6: 1318.51,
  };
  const PENTA_HI = [N.A4, N.B4, N.Cs5, N.E5, N.Fs5, N.A5];
  /** НОМЕР ЗАПИСАННОЙ ТЕМЫ. Объявлен ЗДЕСЬ, а не рядом с самой записью ниже, ровно по одной причине:
   *  `melIdx` инициализируется этой строкой, а `const` в TDZ читать нельзя. Порядок объявления и есть
   *  то, что позволяет умолчанию быть НАЗВАННЫМ, а не совпасть случайно. */
  const TRACK_INDEX = 3;
  /** ⚠️ УМОЛЧАНИЕ — ЗАПИСЬ, а не «первая в списке». Здесь стоял `0`, то есть «Маяк», при том что
   *  документация этого же модуля утверждала «3 · Глубокий космос (запись, по умолчанию)»: код и его
   *  собственный комментарий говорили разное, и владелец услышал именно это расхождение
   *  (2026-08-22: «неверная музыка запустилась, я просил глубокий космос по умолчанию»).
   *  Пара «правда↔зеркало» внутри одного файла — и, как всегда с такими парами, разошлась молча. */
  let melIdx = TRACK_INDEX, padVoice = null, chordStep = 0;
  /* ---- кирпичи -------------------------------------------------------------------------------- */
  function reverb(seconds = 4.5, decay = 2.2) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    const c = ac.createConvolver(); c.buffer = buf; return c;
  }

  function tone({ freq, to = null, type = 'sine', peak = 0.3, attack = 0.005, decay = 0.25, at = 0,
                  send = 0.35, bus = null }) {
    const t = now() + at;
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== null) o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(bus || blipBus);
    if (send > 0) { const s = ac.createGain(); s.gain.value = send; g.connect(s); s.connect(verb); }
    o.start(t); o.stop(t + attack + decay + 0.1);
  }

  function noise(seconds) {
    const n = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf;
    return src;
  }

  function burst({ ms = 6, peak = 0.08, center = 3200, q = 1.4, at = 0, send = 0.3 }) {
    const src = noise(ms / 1000 + 0.01);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = center; bp.Q.value = q;
    const g = ac.createGain();
    const t = now() + at;
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000 + 0.03);
    src.connect(bp); bp.connect(g); g.connect(blipBus);
    if (send > 0) { const s = ac.createGain(); s.gain.value = send; g.connect(s); s.connect(verb); }
    src.start(t);
  }

  /** МЕТАЛЛ: щелчок через НЕгармонические резонансы — у железа обертоны не кратны основному тону,
      поэтому звон есть, а ноты нет, и с темой он не спорит. */
  function metal({ peak = 0.12, decay = 0.5, at = 0, partials = [520, 1170, 1810, 2650, 3900] }) {
    const src = noise(decay + 0.06);
    const t = now() + at;
    for (const f of partials) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = f * rnd(0.96, 1.04); bp.Q.value = rnd(14, 26);
      const g = ac.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * rnd(0.6, 1.1));
      src.connect(bp); bp.connect(g); g.connect(blipBus);
      const s = ac.createGain(); s.gain.value = 0.45; g.connect(s); s.connect(verb);
    }
    src.start(t);
  }

  /* =================================================================================================
     ПАЛИТРА ТЕМБРОВ — семь окрасок одного пика
     =================================================================================================
     Владелец: «пики у тебя не разнообразные, можно добавить разнообразия… добавить им обертонов,
     реверберации, жужжания, искажения». Он прав: почти все пики были чистой волной, а чистая волна
     при любой высоте звучит одинаково — разнообразие высот однообразия тембра не лечит.

     Здесь семь окрасок, и КАЖДАЯ сцена выбирает себе одну ПРИ КАЖДОМ ЗАПУСКЕ. Отсюда двойной эффект:
     внутри сцены прибор звучит как ОДИН прибор (окраска не скачет от ноты к ноте), а от запуска к
     запуску та же сцена звучит иначе. Это разнообразие без каши.

     Высоты по-прежнему из одной пентатоники — окраска меняет ТЕМБР, а не строй. */

  /* 🔴 КЭШИРУЕТСЯ КРИВАЯ, А НЕ УЗЕЛ — и это не микрооптимизация, а починка бага, который владелец
     услышал как «огромное число звуков сразу, громко, искажено».
     Первая редакция кэшировала сам `WaveShaper`. Узел в Web Audio — не функция, а ТОЧКА СХОДА: каждый
     новый пик подключался к тому же экземпляру, и после N пиков у него N входов и N выходов, то есть
     сигнал КАЖДОГО осциллятора уходил в КАЖДЫЙ фильтр. Рост как N², и он накапливался за сессию,
     потому что ничего не отключалось. У «КОНСОЛИ» до 78 пиков за один проход — этого хватало с
     запасом. Массив кривой делить между узлами можно и нужно: он данные, а не соединение. */
  let _curveCache = null;
  function shaperCurve(amount = 4) {
    if (_curveCache && _curveCache.a === amount) return _curveCache.curve;
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    _curveCache = { a: amount, curve };
    return curve;
  }
  function shaper(amount = 4) {
    const ws = ac.createWaveShaper(); ws.curve = shaperCurve(amount); ws.oversample = '2x';
    return ws;
  }

  const COLOURS = ['чистый', 'колокол', 'стекло', 'жужжащий', 'перегруз', 'эхо', 'вауканье'];

  /** Один пик заданной окраски. Высота — из пентатоники, всё остальное решает окраска. */
  function beep({ freq, at = 0, len = 0.3, peak = 0.14, colour = 'чистый', send = 0.5 }) {
    const t = now() + at;
    const out = ac.createGain(); out.gain.value = 1; out.connect(blipBus);
    const s = ac.createGain(); s.gain.value = send; out.connect(s); s.connect(verb);

    const env = (node, p, a, d) => {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g); g.connect(out);
      return g;
    };
    const osc = (f, type = 'sine') => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
                                        o.start(t); o.stop(t + len + 3.0); return o; };

    if (colour === 'чистый') {
      env(osc(freq), peak, 0.006, len);
      env(osc(freq * 2), peak * 0.16, 0.006, len * 0.6);

    } else if (colour === 'колокол') {
      // НЕГАРМОНИЧЕСКИЕ обертоны трубчатого колокола: 1 : 2,76 : 5,40 : 8,93. Именно некратность
      // даёт «звон», которого не бывает у чистого синуса, сколько его ни складывай с октавами.
      // ⚠️ Множитель 0,58 — не вкус, а арифметика: четыре обертона складываются в сумму 1,76 от peak,
      // и без нормировки многосоставная окраска звучит вдвое громче чистой при том же числе.
      [[1, 1, 1.0], [2.76, 0.42, 0.62], [5.40, 0.22, 0.4], [8.93, 0.12, 0.26]]
        .forEach(([r, lv, dk]) => env(osc(freq * r), peak * lv * 0.58, 0.004, len * dk * 2.2));

    } else if (colour === 'стекло') {
      [[1, 1, 1], [3.01, 0.34, 0.5], [5.02, 0.18, 0.3], [7.1, 0.09, 0.2]]
        .forEach(([r, lv, dk]) => env(osc(freq * r), peak * lv * 0.62, 0.002, len * dk));
      burst({ ms: 4, peak: peak * 0.25, center: freq * 6, q: 3, at, send: 0.4 });   // призвук удара

    } else if (colour === 'жужжащий') {
      // Кольцевая модуляция: несущая умножается на низкий тон — отсюда «жужжание», а не вибрато.
      const car = osc(freq, 'sawtooth');
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = freq * 4;
      const ring = ac.createGain(); ring.gain.value = 0;
      const mod = ac.createOscillator(); mod.type = 'sine'; mod.frequency.value = rnd(45, 95);
      const ma = ac.createGain(); ma.gain.value = 1;
      mod.connect(ma); ma.connect(ring.gain); mod.start(t); mod.stop(t + len + 0.4);
      car.connect(lp); lp.connect(ring);
      env(ring, peak * 0.85, 0.008, len);

    } else if (colour === 'перегруз') {
      const o = osc(freq, 'square');
      const ws = shaper(6);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = freq * rnd(1.6, 2.6); bp.Q.value = 2.2;
      o.connect(ws); ws.connect(bp);
      env(bp, peak * 0.8, 0.004, len * 0.8);

    } else if (colour === 'эхо') {
      // Слэпбэк: несколько быстрых повторов — «отскок» от стены ангара, отдельно от общей
      // реверберации, потому что он РИТМИЧЕН, а она размазана.
      // ⚠️ ПЕТЛЯ ОБЯЗАНА БЫТЬ РАЗОРВАНА. Задержка с обратной связью — это цикл в графе: он не
      // собирается сборщиком мусора, пока подключён, и каждый такой пик оставлял в графе вечный
      // живой узел. За час их накапливались сотни. Отключаем по истечении хвоста.
      const d = ac.createDelay(1.0); d.delayTime.value = rnd(0.09, 0.16);
      const fb = ac.createGain(); fb.gain.value = 0.38;
      d.connect(fb); fb.connect(d); d.connect(out);
      const g = env(osc(freq), peak * 0.8, 0.005, len);
      g.connect(d);
      env(osc(freq * 2.01), peak * 0.16, 0.005, len * 0.5);
      const tailMs = (len + 1.6) * 1000;
      setTimeout(() => { try { fb.disconnect(); d.disconnect(); } catch (e) { /* уже */ } }, tailMs);

    } else {  // вауканье
      // Резонанс проезжает по ноте — «уау». Один голос, но слышно движение.
      const o = osc(freq, 'sawtooth');
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
      bp.frequency.setValueAtTime(freq * 0.8, t);
      bp.frequency.exponentialRampToValueAtTime(freq * rnd(3.2, 5.0), t + len * 0.55);
      bp.frequency.exponentialRampToValueAtTime(freq * 1.1, t + len * 1.2);
      o.connect(bp);
      // Резонанс Q=7 сам по себе поднимает уровень в разы — поэтому здесь множитель МЕНЬШЕ единицы,
      // а не больше, как было в первой редакции.
      env(bp, peak * 0.55, 0.01, len * 1.1);
    }
  }

  /** ДУГА: полосовой шум с быстрым СЛУЧАЙНЫМ трепетом амплитуды. Именно трепет отличает сварку от
      шипения крана — десятки провалов в секунду, каждый своей глубины. */
  function arc({ at = 0, dur = 1.2, level = 0.085 }) {
    const t = now() + at;
    const src = noise(dur + 0.06);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = rnd(1200, 2200); bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    let k = t + 0.02;
    while (k < t + dur) { g.gain.exponentialRampToValueAtTime(rnd(0.02, level * 1.15), k); k += rnd(0.008, 0.035); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(blipBus);
    const s = ac.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(verb);
    src.start(t);
  }

  /** ПИТ-СТОПНЫЙ ГАЙКОВЁРТ — «ВЖЖЖЖЖУУУ», как меняют колесо в формуле.
   *
   *  Первая редакция была ТРЕЩОТКОЙ и звучала как «тр-тр-тр»: отдельные удары 22–32 раза в секунду.
   *  Владелец: «не похож на ключ, он должен жужжать вжжжжжууу как когда колёса меняют у формулы один».
   *  Разница физическая, а не в громкости: у пит-гана удары идут 50–60 раз в СЕКУНДУ, и на такой
   *  частоте ухо перестаёт различать отдельные удары — они сливаются в ТОН. Поэтому тело звука здесь
   *  не очередь щелчков, а пила НА ЧАСТОТЕ УДАРОВ, и строится он из трёх слоёв:
   *
   *    1. тело — пила ~30→58 Гц: раскрутка, полка, и сброс вниз в конце. Это и есть «…ууу»;
   *    2. вой воздушного мотора ~0,9→2,3 кГц — то, что делает звук пронзительным, а не тарахтящим;
   *    3. выхлоп — тихий высокий шум: пневматика всегда шипит.
   *
   *  Резонанс полосового фильтра ведётся вверх вместе с оборотами: движущийся формант и даёт «вжжж»
   *  вместо ровного «ззз». */
  function pitGun({ at = 0, dur = 0.9, level = 0.085 }) {
    const t = now() + at;
    const up = dur * 0.20, hold = dur * 0.72;

    const body = ac.createOscillator(); body.type = 'sawtooth';
    body.frequency.setValueAtTime(rnd(26, 32), t);
    body.frequency.exponentialRampToValueAtTime(rnd(52, 62), t + up);
    body.frequency.setValueAtTime(rnd(52, 62), t + hold);
    body.frequency.exponentialRampToValueAtTime(rnd(30, 38), t + dur);

    const whine = ac.createOscillator(); whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(rnd(800, 1000), t);
    whine.frequency.exponentialRampToValueAtTime(rnd(2100, 2600), t + up * 1.1);
    whine.frequency.setValueAtTime(2300, t + hold);
    whine.frequency.exponentialRampToValueAtTime(rnd(950, 1200), t + dur);
    const wg = ac.createGain(); wg.gain.value = 0.30;

    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4.5;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + up * 1.3);
    bp.frequency.setValueAtTime(2600, t + hold);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);

    const air = noise(dur + 0.06);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const ag = ac.createGain(); ag.gain.value = 0.030;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.05);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);

    body.connect(bp); whine.connect(wg); wg.connect(bp);
    air.connect(hp); hp.connect(ag); ag.connect(g);
    bp.connect(g); g.connect(blipBus);
    const s = ac.createGain(); s.gain.value = 0.35; g.connect(s); s.connect(verb);
    body.start(t); whine.start(t); air.start(t);
    body.stop(t + dur + 0.1); whine.stop(t + dur + 0.1);
  }

  /** ВОЛНА СКАНЕРА: медленный шумовой подъём с ведением фильтра вверх — «испускание». */
  function wave({ at = 0, dur = 1.1, from = 240, to = 2600, level = 0.075 }) {
    const t = now() + at;
    const src = noise(dur + 0.06);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.0;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(blipBus);
    const s = ac.createGain(); s.gain.value = 0.7; g.connect(s); s.connect(verb);
    src.start(t);
  }

  /** ЖУЖЖАНИЕ СКАНЕРА: тон с амплитудной модуляцией — «работает, обрабатывает». */
  function amBuzz({ at = 0, dur = 0.7, freq = 210, rate = 34, level = 0.06 }) {
    const t = now() + at;
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ac.createGain(); g.gain.value = 0.0001;
    const m = ac.createOscillator(); m.type = 'square'; m.frequency.value = rate;
    const ma = ac.createGain(); ma.gain.value = level * 0.5;
    m.connect(ma); ma.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * 0.5, t + 0.05);
    g.gain.setValueAtTime(level * 0.5, t + dur - 0.06);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(blipBus);
    const s = ac.createGain(); s.gain.value = 0.35; g.connect(s); s.connect(verb);
    o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  }

  /** СЕРВОПРИВОД МАНИПУЛЯТОРА — один ход руки. Высота тона здесь и есть СКОРОСТЬ: привод
   *  разгоняется, идёт на полке и тормозит, поэтому частота поднимается и опускается внутри
   *  одного движения. Без торможения получился бы обрубленный писк, а не механизм.
   *  Зубчатый призвук — вторая гармоника с лёгкой расстройкой: редуктор, а не чистый мотор.
   *  В конце хода — мягкий стук: рука пришла в позицию. */
  function servo({ at = 0, dur = 1.0, top = 250, level = 0.06 }) {
    const t = now() + at;

    // ТРЕУГОЛЬНИК ВМЕСТО ПИЛЫ — та же причина, что и у турбины: пила несёт полный набор гармоник и
    // читается как резкость. У привода это особенно слышно, потому что ход короткий и звук голый.
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(top * 0.22, t);
    // РАЗГОН И ТОРМОЖЕНИЕ ЗАНИМАЮТ БОЛЬШЕ, ЧЕМ ПОЛКА. Прежде привод выходил на скорость за треть
    // хода и стоял на ней две трети — это и слышалось как рывок. Тяжёлая рука разгоняется дольше,
    // чем едет, и тормозит ещё дольше, чем разгоняется.
    o.frequency.exponentialRampToValueAtTime(top, t + dur * 0.42);
    o.frequency.setValueAtTime(top, t + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(top * 0.24, t + dur);

    // Редуктор вдвое тише и тоже без пилы: он призвук, а не голос.
    const gear = ac.createOscillator(); gear.type = 'triangle';
    gear.frequency.setValueAtTime(top * 2.02, t);
    gear.frequency.exponentialRampToValueAtTime(top * 2.02 * 1.04, t + dur);
    const gg = ac.createGain(); gg.gain.value = 0.055;

    // Фильтр ниже и шире: было top*6 при Q 1,4 — оттуда бралась вся визгливость.
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = top * 3; lp.Q.value = 0.8;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur * 0.22);   // вход мягкий, а не щелчком
    g.gain.setValueAtTime(level, t + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    o.connect(lp); gear.connect(gg); gg.connect(lp); lp.connect(g); g.connect(blipBus);
    const sd = ac.createGain(); sd.gain.value = 0.4; g.connect(sd); sd.connect(verb);
    o.start(t); gear.start(t); o.stop(t + dur + 0.2); gear.stop(t + dur + 0.2);

    // Стук позиционирования приглушён и уведён вниз: рука ПРИХОДИТ в позицию, а не ударяется.
    metal({ peak: 0.028, decay: 0.22, at: at + dur, partials: [260, 610, 1040] });

  }

  /** БОЛГАРКА — рез по металлу. Три вещи, без которых это просто шум:
   *    1. мотор ПРОСЕДАЕТ под нагрузкой: в момент реза частота падает и возвращается на выходе из
   *       реза. Именно просадка читается как «режет», а не «крутится вхолостую»;
   *    2. визг реза — узкий полосовой шум 3–7 кГц с быстрым трепетом: диск идёт по металлу неровно;
   *    3. ИСКРЫ — десятки крошечных уколов на 5–9 кГц вразнобой, каждый своей громкости.
   *  Без искр рез звучит стерильно, без просадки — фальшиво. */
  function grinder({ at = 0, dur = 1.6, level = 0.05, spinUp = false }) {
    const t = now() + at;

    /* ПОЧЕМУ ПРЕЖНЯЯ ВЕРСИЯ ЗВУЧАЛА ПАРОВОЗОМ, дословно по слуху владельца: «болгарка не похожа на
       болгарку, а похожа на паровоз». Две причины, обе в реализации, а не в громкости:
         1. МОТОР БЫЛ НИЗКИМ — пила 240 -> 168 Гц. У болгарки диск идёт под 11 000 об/мин, и её
            голос это ВЫСОКИЙ ровный вой около двух килогерц, а не басовитое урчание;
         2. ТРЕПЕТ ШУМА БЫЛ ГЛУБОКИМ И МЕДЛЕННЫМ — провалы амплитуды каждые 10–45 мс. Медленная
            глубокая пульсация низкого тона это буквально чух-чух. Рез металла пульсирует НАМНОГО
            быстрее и НАМНОГО мельче: диск идёт по шву неровно, но не рывками.
       Отсюда лечение: тон поднят на порядок, пульсация переведена в быструю мелкую модуляцию
       (70 Гц вместо 20–100 мс провалов), общий уровень опущен с 0,085 до 0,05. */

    // ВОЙ ДИСКА — две высокие составляющие. Под нагрузкой обе слегка проседают и возвращаются на
    // выходе из реза: именно просадка читается как «режет», а не «крутится вхолостую».
    const f0 = spinUp ? 700 : 1950;
    const disc = ac.createOscillator(); disc.type = 'triangle';
    const upper = ac.createOscillator(); upper.type = 'triangle';
    const ug = ac.createGain(); ug.gain.value = 0.3;
    if (spinUp) {
      disc.frequency.setValueAtTime(320, t);
      disc.frequency.exponentialRampToValueAtTime(1950, t + dur * 0.85);
      upper.frequency.setValueAtTime(320 * 2.7, t);
      upper.frequency.exponentialRampToValueAtTime(1950 * 2.7, t + dur * 0.85);
    } else {
      disc.frequency.setValueAtTime(f0, t);
      disc.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + 0.12);   // просадка под нагрузкой
      disc.frequency.setValueAtTime(f0 * 0.82, t + dur - 0.15);
      disc.frequency.exponentialRampToValueAtTime(f0 * 1.02, t + dur);    // отпустило
      upper.frequency.setValueAtTime(f0 * 2.7, t);
      upper.frequency.exponentialRampToValueAtTime(f0 * 2.7 * 0.82, t + 0.12);
      upper.frequency.setValueAtTime(f0 * 2.7 * 0.82, t + dur - 0.15);
      upper.frequency.exponentialRampToValueAtTime(f0 * 2.7 * 1.02, t + dur);
    }
    const dg = ac.createGain(); dg.gain.value = 0.30;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + (spinUp ? dur * 0.6 : 0.06));
    g.gain.setValueAtTime(level, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);

    disc.connect(dg); dg.connect(g);
    upper.connect(ug); ug.connect(g);
    disc.start(t); upper.start(t); disc.stop(t + dur + 0.2); upper.stop(t + dur + 0.2);

    if (!spinUp) {
      // ВИЗГ РЕЗА — узкий полосовой шум 3,5–5,5 кГц с БЫСТРОЙ МЕЛКОЙ модуляцией: диск идёт по шву
      // неровно. Модулятор на 70 Гц, глубина малая — это шелест реза, а не пульсация пара.
      const cut = noise(dur + 0.08);
      const cbp = ac.createBiquadFilter(); cbp.type = 'bandpass';
      cbp.frequency.value = rnd(3500, 5500); cbp.Q.value = 3.2;
      const cg = ac.createGain(); cg.gain.value = 0.0001;
      const mod = ac.createOscillator(); mod.type = 'sine'; mod.frequency.value = rnd(58, 92);
      const ma = ac.createGain(); ma.gain.value = level * 0.22;
      mod.connect(ma); ma.connect(cg.gain);
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(level * 0.85, t + 0.05);
      cg.gain.setValueAtTime(level * 0.85, t + dur - 0.1);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      cut.connect(cbp); cbp.connect(cg); cg.connect(g);
      mod.start(t); mod.stop(t + dur + 0.1);
      cut.start(t);

      // ИСКРЫ — реже и тише прежнего: они приправа, а не блюдо.
      const sparks = Math.floor(dur * rnd(7, 13));
      for (let k = 0; k < sparks; k++) {
        burst({ ms: 3, peak: rnd(0.006, 0.022), center: rnd(6000, 9500), q: 4, at: at + rnd(0.05, dur), send: 0.45 });
      }
    }

    g.connect(blipBus);
    const sd = ac.createGain(); sd.gain.value = 0.4; g.connect(sd); sd.connect(verb);

  }

  /** ГУЛ ТРАНСФОРМАТОРА. Не «низкий тон», а именно сетевой гул: 50 Гц и ЕГО ГАРМОНИКИ 100 и 150,
   *  потому что железо сердечника гудит на удвоенной частоте сети, а не на основной. Отсюда
   *  характерное «жжж» вместо ровного баса. Медленное покачивание фильтра — дыхание нагрузки. */
  function transformerHum({ at = 0, dur = 6, level = 0.055 }) {
    const t = now() + at;
    const oscs = [];
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 1.6;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.5);
    g.gain.setValueAtTime(level, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, lv] of [[50, 1], [100, 0.75], [150, 0.35], [200, 0.18]]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * rnd(0.996, 1.004);
      const og = ac.createGain(); og.gain.value = lv * 0.5;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.15); oscs.push(o);
    }
    const w = ac.createOscillator(); w.frequency.value = 0.22;
    const wa = ac.createGain(); wa.gain.value = 90;
    w.connect(wa); wa.connect(lp.frequency); w.start(t); w.stop(t + dur + 0.15);
    lp.connect(g); g.connect(blipBus);
    const sd = ac.createGain(); sd.gain.value = 0.3; g.connect(sd); sd.connect(verb);
  }

  /** ИМПУЛЬС ЭЛЕКТРОЭНЕРГИИ — «посылка». Вибрация здесь не метафора: несущая идёт через кольцевую
   *  модуляцию 38–70 Гц, и именно она даёт дрожь, а не вибрато. Тон рушится вниз (разряд не
   *  «поёт», он СБРАСЫВАЕТСЯ), сверху трещит шум. Ни одной ноты — поэтому ни на что в наборе не
   *  похоже и колокольчиком не читается. */
  function zap({ at = 0, dur = 0.5, level = 0.085 }) {
    const t = now() + at;
    const car = ac.createOscillator(); car.type = 'sawtooth';
    car.frequency.setValueAtTime(rnd(700, 950), t);
    car.frequency.exponentialRampToValueAtTime(rnd(90, 140), t + dur);
    const ring = ac.createGain(); ring.gain.value = 0;
    const mod = ac.createOscillator(); mod.type = 'square'; mod.frequency.value = rnd(38, 70);
    const ma = ac.createGain(); ma.gain.value = 1;
    mod.connect(ma); ma.connect(ring.gain);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(ring); ring.connect(bp); bp.connect(g); g.connect(blipBus);
    const sd = ac.createGain(); sd.gain.value = 0.55; g.connect(sd); sd.connect(verb);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    // Треск поверх разряда — три коротких шумовых укола вразнобой.
    for (let k = 0; k < 3; k++) burst({ ms: 5, peak: level * 0.5, center: rnd(2200, 4200), q: 2.5, at: at + rnd(0, dur * 0.6), send: 0.4 });
  }

  /** ТУРБИНА — разгон и выход на обороты: куллер, реактивный двигатель, «что-то запускается».
   *  Слово владельца: «если это запуск, пусть какая-нибудь турбинка набирает обороты, звук куллера,
   *  реактивного двигателя». Четыре слоя, и каждый отвечает за свою половину узнавания:
   *    1. ВАЛ — пила 38 -> 190 Гц: сам разгон, то, что слышно как «набирает»;
   *    2. ЛОПАТКИ — амплитудная модуляция, частота которой растёт ВМЕСТЕ с валом. Это она делает
   *       звук лопастным, а не просто воющим: у вентилятора тон лопаток кратен оборотам;
   *    3. ВОЗДУХ — шум через полосовой фильтр, ведомый вверх: поток, который турбина гонит;
   *    4. ВОЙ — высокая пила 280 -> 1900 Гц, придающая реактивность.
   *  Выход на полку и лёгкое покачивание в конце: машина вышла на режим и держит его. */
  function turbine({ at = 0, dur = 5.2, level = 0.07, bright = 1 }) {
    const t = now() + at;
    const up = dur * 0.82;            // разгон занимает почти всю сцену — ротор тяжёлый

    // ВАЛ — ТРЕУГОЛЬНИК, А НЕ ПИЛА. Пила несёт полный набор гармоник и именно она делала звук
    // «злым»; у треугольника нечётные и быстро спадающие, поэтому тот же разгон читается мягко.
    const shaft = ac.createOscillator(); shaft.type = 'triangle';
    shaft.frequency.setValueAtTime(30, t);
    // РАЗГОН В ДВА ЭТАПА: сперва тяжело и медленно, потом легче. Один экспоненциальный подъём даёт
    // «включили и сразу поехало»; инерцию слышно только когда начало ощутимо труднее конца.
    shaft.frequency.exponentialRampToValueAtTime(72, t + up * 0.55);
    shaft.frequency.exponentialRampToValueAtTime(165, t + up);
    shaft.frequency.linearRampToValueAtTime(160, t + dur);

    // ВОЙ — тоже треугольник, и потолок опущен с 1900 до 1150 Гц: выше начинается та резкость,
    // из-за которой звук воспринимался как агрессивный, а не как работающая машина.
    const whine = ac.createOscillator(); whine.type = 'triangle';
    whine.frequency.setValueAtTime(220, t);
    whine.frequency.exponentialRampToValueAtTime(520, t + up * 0.55);
    whine.frequency.exponentialRampToValueAtTime(1150 * bright, t + up);
    whine.frequency.linearRampToValueAtTime(1100 * bright, t + dur);
    const wg = ac.createGain(); wg.gain.value = 0.14 * bright;   // было 0,22 — вой отодвинут назад

    // Резонанс шире (Q 1,1 против 2,6): узкая полоса звучит гнусаво и напряжённо.
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(1500 * bright, t + up);
    // Общий низкий фильтр сверху — он и снимает остаток жёсткости.
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 2300 * bright; lp.Q.value = 0.7;

    // ЛОПАТКИ: глубина модуляции вдвое меньше (0,16 против 0,35). Глубокая модуляция рубит звук на
    // куски и слышится как рычание; мелкая оставляет лопастный характер, но не давит.
    const blade = ac.createOscillator(); blade.type = 'sine';
    blade.frequency.setValueAtTime(7, t);
    blade.frequency.exponentialRampToValueAtTime(34, t + up);
    const bladeAmp = ac.createGain(); bladeAmp.gain.value = 0.16;

    const air = noise(dur + 0.1);
    const ahp = ac.createBiquadFilter(); ahp.type = 'highpass';
    ahp.frequency.setValueAtTime(400, t);
    ahp.frequency.exponentialRampToValueAtTime(1500, t + up);
    const ag = ac.createGain();
    ag.gain.setValueAtTime(0.0001, t);
    ag.gain.exponentialRampToValueAtTime(0.028, t + up);
    ag.gain.exponentialRampToValueAtTime(0.014, t + dur);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Вход втрое медленнее прежнего: машина проявляется, а не включается щелчком.
    g.gain.exponentialRampToValueAtTime(level, t + up * 0.85);
    g.gain.setValueAtTime(level, t + dur - 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    blade.connect(bladeAmp); bladeAmp.connect(g.gain);

    shaft.connect(bp); whine.connect(wg); wg.connect(bp);
    bp.connect(lp);
    air.connect(ahp); ahp.connect(ag); ag.connect(g);
    lp.connect(g); g.connect(blipBus);
    const s2 = ac.createGain(); s2.gain.value = 0.5; g.connect(s2); s2.connect(verb);
    shaft.start(t); whine.start(t); blade.start(t); air.start(t);
    shaft.stop(t + dur + 0.55); whine.stop(t + dur + 0.55); blade.stop(t + dur + 0.55);

  }

  /** ОСТУЖЕНИЕ ШВА: длинное шипение, уходящее вниз. */
  function hiss({ at = 0, dur = 1.4, level = 0.05 }) {
    const t = now() + at;
    const src = noise(dur + 0.05);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(blipBus);
    const s = ac.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(verb);
    src.start(t);
  }

  /* =================================================================================================
     ТЕМА
     ================================================================================================= */

  /** Нота темы: медленная атака и длинный хвост — соседние ноты физически накладываются, и это и
      есть «перетекание», о котором просил владелец. Тембр — характер «Дальнего»: треугольник под
      низким фильтром плюс очень тихий верхний обертон. */
  function melNote({ freq, at = 0, len = 1.8, peak = 0.10 }) {
    const t = now() + at;
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.001;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.5;
    const g = ac.createGain(); const g2 = ac.createGain(); g2.gain.value = 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + len * 0.38);          // медленный вход
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 2.2);         // длинный хвост
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(melBus);
    const s = ac.createGain(); s.gain.value = 0.95; g.connect(s); s.connect(verb);
    o.start(t); o2.start(t); o.stop(t + len + 2.4); o2.stop(t + len + 2.4);
  }

  /* ТРИ РИСУНКА. Отличаются КОНТУРОМ — тем единственным, что не меняется при вариациях, и потому
     единственным, что запоминается. Ступени даны индексами по пентатонике, чтобы мотив можно было
     переносить, не выходя из строя. */
  const SCALE = [N.A3, N.B3, N.Cs4, N.E4, N.Fs4, N.A4, N.B4, N.Cs5, N.E5, N.Fs5, N.A5, N.B5, N.Cs6];

  /* =================================================================================================
     РИТМ ТЕМЫ — ПО `researches/12`, а не на глаз
     =================================================================================================
     Первая редакция задавала длительности в секундах «на глаз»: 1,5 / 1,3 / 2,2 / 1,4 / 2,6 — все
     средние, отношение крайних 2:1, промежутки случайные. Владелец услышал это как «не мелодия», и
     разведка объяснила почему: у фразы не было РИТМИЧЕСКОЙ ИЕРАРХИИ. Источники в один голос: рисунок
     делает не набор высот, а СООТНОШЕНИЕ ДЛИТЕЛЬНОСТЕЙ (masterclass, edmprod, speedsongwriting).

     Что кодируют константы ниже — правила П1–П5 документа:
       П1  длительности в ДОЛЯХ сетки 0,8 с (75 BPM — середина медитативного диапазона 70–80,
           bpmcalc), а не в секундах. Каждая нота смещается на случайные ±40 мс: «свобода от сетки»,
           без которой эмбиент перестаёт дышать (musicproductionwiki);
       П2  ритм ЗАДАН явно, отношение крайних длительностей не меньше 4:1;
       П3  последняя нота фразы — самая длинная И за ней пауза (arxiv: «либо…либо»; в эмбиенте, где
           нот мало, работает сочетание);
       П4  пауза между фразами 2–4 доли, и после «вопроса» она КОРОЧЕ: незакрытая фраза требует
           продолжения, закрытая — тишины;
       П5  первая нота и самая длинная начинаются на ЦЕЛОЙ доле — опора; остальные могут смещаться
           на полдоли (iconcollective: ноты на сильных долях весомее). */

  let BEAT = 0.8;                   // базовая доля, 75 BPM — меняется ползунком темпа

  const MELODIES = [
    { name: 'I · Маяк', contour: '♩♩ ♩♩♩ · ♩ · ♩♩♩♩♩♩',
      what: 'Взлёт на кварту, шаг вверх, обрыв вниз. Ритм: две коротких — разбег, третья — первая ' +
            'опора, последняя держится шесть долей. Отношение крайних 6:1 — именно оно и делает рисунок.',
      steps: [5, 8, 9, 6, 7], beats: [1, 1, 3, 1, 6], strong: [0, 2] },
    { name: 'II · Дрейф', contour: '♩ ♩♩ ♩♩ ♩♩♩ · ♩×8',
      what: 'Ровный спуск, каждая нота длиннее предыдущей, последняя — восемь долей. Движение без ' +
            'цели, как затухающий дрейф. Отношение крайних 8:1.',
      steps: [8, 7, 6, 5, 3], beats: [1, 2, 2, 3, 8], strong: [0, 4] },
    { name: 'III · Позывной', contour: '♪♩♩ ♪♩♩ ♩ · ♩×6',
      what: 'Короткая-длинная дважды, потом разрешение вниз — рисунок радиопозывного. Качка на ' +
            'полудолях, разрешение на целой.',
      steps: [7, 9, 7, 9, 6, 5], beats: [0.5, 1.5, 0.5, 1.5, 1, 6], strong: [0, 5] },
  ];

  /* П6 — РАЗВИТИЕ МОТИВА ЦИКЛОМ ИЗ ВОСЬМИ ХОДОВ, а не случайными вариациями.
     Источники называют условием запоминаемости АРКУ и баланс повтора с вариацией (musicradar,
     pointblank); случайная последовательность приёмов арки не даёт. Приёмы — те, что перечисляет
     vaia: повторение, вариация, аугментация, диминуция, ритмическое смещение, повтор контура. */
  const MOVES = [
    { name: 'тема',           shift: 0, oct: 0,  scale: 1,   take: 0, lastX: 1,   sync: false, peak: 1 },
    { name: 'повтор контура', shift: 2, oct: 0,  scale: 1,   take: 0, lastX: 1,   sync: false, peak: 1 },
    { name: 'вопрос',         shift: 0, oct: 0,  scale: 1,   take: 3, lastX: 1,   sync: false, peak: 0.9, question: true },
    { name: 'ответ',          shift: 0, oct: 0,  scale: 1,   take: 0, lastX: 2,   sync: false, peak: 1 },
    { name: 'аугментация',    shift: 0, oct: -5, scale: 1.5, take: 0, lastX: 1,   sync: false, peak: 0.95 },
    { name: 'смещение',       shift: 2, oct: 0,  scale: 1,   take: 0, lastX: 1,   sync: true,  peak: 1 },
    { name: 'диминуция',      shift: 0, oct: 5,  scale: 0.6, take: 0, lastX: 1,   sync: false, peak: 0.55 },
    { name: 'домой',          shift: 0, oct: 0,  scale: 1,   take: 0, lastX: 2.5, sync: false, peak: 1 },
  ];
  let moveIdx = 0;

  /* ===============================================================================================
     ЗАПИСАННАЯ ТЕМА — готовый трек владельца (слово 2026-08-22: «я тебе готовый mp3 дал, просто его
     встрой в зоопарк готовых тем», «его не нужно разбирать»)
     ===============================================================================================
     Это тема ДРУГОГО РОДА, и притворяться, что она такая же, значило бы городить лишнее: у неё нет
     ни контура, ни ходов цикла, ни аккордов под ней — она уже написана целиком. Поэтому она не
     входит в `MELODIES`, а живёт своим индексом, и весь синтезированный аппарат при ней молчит.

     Идёт ПО КРУГУ (`loop`), как заказано. Звук ведётся через общий узел графа, а не мимо него:
     тогда её накрывает и лимитер, и двадцатисекундная подача громкости на старте, — иначе запись
     вступала бы сразу на полной, пока синтезированные темы поднимаются плавно.

     Путь относительный — он верен для стенда прослушивания, который открывают файлом. Живая
     страница получает его переписанным на серверный `/theme.mp3` (сборщик, как со шрифтом и
     логотипом): у окна прогона нет доступа к файлам мимо своего сервера.

     `TRACK_INDEX` объявлен ВЫШЕ, рядом с `melIdx`, потому что он и есть умолчание. */
  const TRACK = {
    name: 'Глубокий космос',
    url: '../assets/dashboard/themes/deep-space.mp3',
    what: 'Записанная тема, 4 мин 10 с, играет по кругу. Космический эмбиент — выбор владельца.',
  };
  let trackEl = null;

  function trackStart() {
    if (!armed) return;
    if (!trackEl) {
      trackEl = new Audio(TRACK.url);
      trackEl.loop = true;                       // круг даёт сам элемент — без склейки и без таймера
      trackEl.preload = 'auto';
      // Через граф — ради лимитера и подачи. Но ТОЛЬКО когда страница пришла по сети: у `file://`
      // каждый файл считается чужим источником: элемент «портит» граф, и тот отдаёт ТИШИНУ —
      // причём без единой ошибки, так что запасной путь по `catch` здесь не сработал бы. На стенде
      // прослушивания элемент играет сам, мимо лимитера: это слышно, а молчание — нет.
      const sameOrigin = location.protocol === 'http:' || location.protocol === 'https:';
      if (sameOrigin) {
        try { ac.createMediaElementSource(trackEl).connect(master); } catch (e) { /* играет напрямую */ }
      }
    }
    try { trackEl.currentTime = 0; } catch (e) { /* ещё не готов — начнёт с начала сам */ }
    const p = trackEl.play();
    if (p && p.catch) p.catch(() => { /* автозапуск не дали — щелчок человека вернёт сюда же */ });
  }

  function trackStop() {
    if (!trackEl) return;
    trackEl.pause();                             // МГНОВЕННО, слово владельца: «отдавать очередь новой»
    try { trackEl.currentTime = 0; } catch (e) { /* неважно: следующий пуск всё равно с нуля */ }
  }

  /* Гармония под темой: открытые квинты, без терций — так «Дальний» и звучал. Меняется очень
     медленно, поэтому один и тот же мотив каждый раз окрашен иначе, хотя рисунок тот же. */
  const CHORDS = [[N.A1, N.E2], [N.Fs2, N.Cs3], [N.D3, N.A2], [N.E2, N.B2]];

  function padOn(freqs) {
    const oscs = [];
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.6;
    const g = ac.createGain(); g.gain.value = 0.0001;
    for (const f of freqs) for (const det of [1, 1.005]) {
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f * det;
      o.connect(lp); o.start(); oscs.push(o);
    }
    const l = ac.createOscillator(); l.frequency.value = 0.035;
    const la = ac.createGain(); la.gain.value = 120;
    l.connect(la); la.connect(lp.frequency); l.start(); oscs.push(l);
    lp.connect(g); g.connect(padBus);
    const s = ac.createGain(); s.gain.value = 0.9; g.connect(s); s.connect(verb);
    g.gain.exponentialRampToValueAtTime(0.075, now() + 3.0);
    // Длительность ухода — параметр: смена АККОРДА внутри темы должна быть незаметной (3 с
    // перекрёстного затухания), а смена САМОЙ ТЕМЫ — мгновенной. Ноль не берём: обрыв синуса на
    // ненулевой амплитуде — это щелчок, а не тишина; сотая доля секунды его снимает и на слух
    // неотличима от мгновенного.
    return { stop(sec = 3.0) {
      const t = now();
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      setTimeout(() => oscs.forEach((o) => { try { o.stop(); } catch (e) { /* уже */ } }), sec * 1000 + 200);
    } };
  }

  function rollChord() {
    if (!soundOn || melIdx < 0 || melIdx === TRACK_INDEX) return;   // под записью аккордов нет
    const nextPad = padOn(CHORDS[chordStep % CHORDS.length]);
    const old = padVoice; padVoice = nextPad;
    if (old) old.stop();                                  // перекрёстное затухание, а не переключение
    chordStep += 1;
  }

  /** Одна фраза цикла. Контур неизменен ВСЕГДА — меняется всё остальное, и меняется ПО ПОРЯДКУ,
      ходом цикла, а не случаем: восемь ходов складываются в арку, случайные вариации — нет. */
  function playPhrase() {
    // Записанная тема сюда не заходит вовсе: у неё нет фразы, и `MELODIES[3]` не существует —
    // без этой половины условия цикл фраз разыменовал бы пустоту на первом же тике.
    if (!soundOn || melIdx < 0 || melIdx === TRACK_INDEX) { melTimer = setTimeout(playPhrase, 2000); return; }
    const m = MELODIES[melIdx];
    const mv = MOVES[moveIdx % MOVES.length];
    const strong = new Set(m.strong);
    const nn = mv.take > 0 ? Math.min(mv.take, m.steps.length) : m.steps.length;

    let cursor = 0;                                       // положение в ДОЛЯХ, не в секундах
    for (let i = 0; i < nn; i++) {
      const isLast = i === nn - 1;
      const beats = m.beats[i] * mv.scale * (isLast ? mv.lastX : 1);

      // П5: опорные ноты садятся на ЦЕЛУЮ долю. Округление ВВЕРХ, а не к ближайшей: нота никогда не
      // должна поехать назад — это задвинуло бы её под предыдущую и съело бы паузу перед опорой,
      // ради которой опора и существует.
      let start = strong.has(i) ? Math.ceil(cursor - 1e-6) : cursor;
      if (mv.sync && !strong.has(i)) start += 0.5;        // ход «смещение» — синкопа на полдоли

      const idx = Math.min(SCALE.length - 1, Math.max(0, m.steps[i] + mv.shift + mv.oct));
      // П1: дрожание ±40 мс. Без него сетка слышна как машинная.
      const atSec = Math.max(0, start * BEAT + rnd(-0.04, 0.04));
      const lenSec = beats * BEAT;
      melNote({ freq: SCALE[idx], at: atSec, len: lenSec, peak: 0.095 * mv.peak });

      // Отзвук квинтой выше через две трети ноты — он и размазывает фразу в перетекание (П7).
      if (!isLast && Math.random() < 0.4) {
        melNote({ freq: SCALE[Math.min(SCALE.length - 1, idx + 3)],
                  at: atSec + lenSec * 0.66, len: lenSec * 0.6, peak: 0.026 * mv.peak });
      }
      // П7: следующая входит, когда предыдущая прошла ~70 % — ноты физически накладываются.
      // Последняя досчитывается ПОЛНОСТЬЮ: за ней обязана быть тишина, а не наезд.
      cursor = start + beats * (isLast ? 1 : 0.7);
    }

    // П3+П4: за самой длинной последней нотой — пауза 2–4 доли; после «вопроса» короче, потому что
    // незакрытая фраза требует продолжения, а закрытая — тишины.
    const rest = rnd(2, 4) * (mv.question ? 0.55 : 1);
    onMove(`${(moveIdx % MOVES.length) + 1}/8 · ${mv.name}`);
    moveIdx += 1;

    melTimer = setTimeout(playPhrase, (cursor + rest) * BEAT * 1000);
  }

  /* =================================================================================================
     СЦЕНЫ ДОКА — у каждой начало, середина и конец
     ================================================================================================= */
  const SCENES = [
    { tag: 'ОПРОС', grp: 'приборы', on: true, dur: 3.6,
      hint: 'система обходит узлы: три-четыре группы бипов и подтверждение в конце',
      what: 'Группы по 2–3 ноты пентатоники с паузами, финал — восходящая пара «готово»',
      play() {
        // Окраска выбирается ОДИН раз на весь обход: внутри сцены это один прибор, а от запуска к
        // запуску — каждый раз другой. Отсюда разнообразие без каши.
        const c = pick(['чистый', 'жужжащий', 'перегруз', 'стекло', 'эхо']);
        let at = 0;
        const groups = 3 + Math.floor(Math.random() * 2);
        for (let g = 0; g < groups; g++) {
          const base = Math.floor(rnd(0, 3));
          const nn = 2 + Math.floor(Math.random() * 2);
          for (let i = 0; i < nn; i++) {
            beep({ freq: PENTA_HI[base + i], peak: 0.14, len: 0.22, colour: c, at, send: 0.5 });
            at += rnd(0.15, 0.24);
          }
          at += rnd(0.35, 0.6);
        }
        beep({ freq: N.Cs5, peak: 0.13, len: 0.3, colour: 'колокол', at, send: 0.7 });
        beep({ freq: N.A5, peak: 0.13, len: 0.6, colour: 'колокол', at: at + 0.16, send: 0.7 });
        return at + 0.9;
      } },

    { tag: 'КОНСОЛЬ', grp: 'приборы', on: true, dur: 4.2,
      hint: 'выдача данных: очередь частых чирпов, пауза, ещё очередь',
      what: 'Две-три очереди по 7–13 быстрых двухнотных чирпов, между ними паузы, в конце подтверждение',
      play() {
        const c = pick(['перегруз', 'перегруз', 'жужжащий', 'стекло']);   // выдача данных любит грязь
        let at = 0;
        const runs = 2 + Math.floor(Math.random() * 2);
        for (let r = 0; r < runs; r++) {
          // Плотность урезана: было до 13 чирпов на очередь, то есть под 80 пиков за сцену. Даже
          // после починки узла искажения это перебор — очередь читается ухом уже с пяти-девяти.
          const nn = 5 + Math.floor(Math.random() * 5);
          for (let i = 0; i < nn; i++) {
            const k = Math.floor(Math.random() * 4);
            beep({ freq: PENTA_HI[k], peak: 0.05, len: 0.035, colour: c, at, send: 0.25 });
            beep({ freq: PENTA_HI[k + 1], peak: 0.05, len: 0.05, colour: c, at: at + 0.035, send: 0.25 });
            at += rnd(0.07, 0.13);
          }
          at += rnd(0.45, 0.9);
        }
        // ФИНАЛ КОНСОЛИ ОТЛИЧЁН ОТ ФИНАЛА ОПРОСА ТРЕМЯ ПРИЗНАКАМИ СРАЗУ. У опроса колокол ВВЕРХ в
        // верхнем регистре; здесь сухая пара ВНИЗ на перегрузе, октавой ниже. Одного отличия мало:
        // ухо ловит жест целиком, а жест — это направление плюс окраска плюс регистр.
        beep({ freq: N.B4, peak: 0.11, len: 0.09, colour: 'перегруз', at, send: 0.25 });
        beep({ freq: N.Fs4, peak: 0.12, len: 0.26, colour: 'перегруз', at: at + 0.10, send: 0.3 });
        return at + 0.7;
      } },

    { tag: 'СОНАР', grp: 'приборы', on: true, dur: 7.5,
      hint: 'серия посылок с ровным шагом, у одной приходит отражение',
      what: '4–6 пингов через равные промежутки, длинные хвосты; после одного — тихий ответ другой высоты',
      play() {
        let at = 0;
        const nn = 4 + Math.floor(Math.random() * 3);
        const gap = rnd(1.15, 1.5);
        const echoOn = 1 + Math.floor(Math.random() * (nn - 1));
        // Два разных прибора: один со скольжением высоты (классический пинг), другой колокольный.
        const glide = Math.random() < 0.5;
        const c = pick(['колокол', 'стекло', 'эхо']);
        for (let i = 0; i < nn; i++) {
          const p = 0.17 * (1 - i * 0.06);
          if (glide) tone({ freq: N.Fs5, to: N.Cs5, peak: p, decay: 0.6, at, send: 0.95 });
          else beep({ freq: N.Fs5, peak: p, len: 0.6, colour: c, at, send: 0.95 });
          if (i === echoOn) {
            if (glide) tone({ freq: N.B4, to: N.A4, peak: 0.07, decay: 0.8, at: at + rnd(0.45, 0.75), send: 1.0 });
            else beep({ freq: N.B4, peak: 0.07, len: 0.8, colour: c, at: at + rnd(0.45, 0.75), send: 1.0 });
          }
          at += gap;
        }
        return at;
      } },

    { tag: 'ПУЛЬСАР', grp: 'приборы', on: true, dur: 3.4,
      hint: 'бип-боп перебирает и затихает',
      what: 'Две ноты по очереди 8–14 раз, темп чуть растёт, громкость тает',
      play() {
        let at = 0, gap = rnd(0.22, 0.3);
        const nn = 8 + Math.floor(Math.random() * 7);
        // ДВЕ РАЗНЫЕ окраски на две ноты — «бип» и «боп» звучат разными приборами, как в переговорах.
        const cA = pick(['чистый', 'жужжащий', 'вауканье']);
        const cB = pick(['перегруз', 'стекло', 'эхо']);
        for (let i = 0; i < nn; i++) {
          beep({ freq: i % 2 ? N.E5 : N.A4, colour: i % 2 ? cA : cB,
                 peak: 0.13 * (1 - i / (nn * 1.4)), len: 0.16, at, send: 0.4 });
          at += gap; gap *= 0.97;
        }
        return at + 0.3;
      } },

    { tag: 'ЗАПУСК', grp: 'работа дока', on: true, dur: 7.5,
      hint: 'турбина мягко и долго набирает обороты и выходит на режим: куллер, реактивный двигатель',
      what: 'Тумблер, ДОЛГИЙ разгон вала 30->165 Гц в два этапа (тяжело, потом легче), лопатки, поток воздуха, выход на режим и два тихих щелчка реле',
      play() {
        // Ни одной ноты: запуск — это МАШИНА, а не прибор. Тумблер, разгон турбины, выход на
        // обороты и два сухих щелчка реле «вышли на режим». Колокольчика здесь больше нет вовсе.
        // Тумблер приглушён и уведён вниз: резкий щелчок на старте задавал всей сцене
        // агрессивный тон ещё до того, как турбина скажет хоть что-то.
        burst({ ms: 11, peak: 0.045, center: 900, q: 1.2, at: 0, send: 0.3 });     // тумблер
        const dur = rnd(4.5, 6.5);                                                // разгон долгий
        turbine({ at: 0.2, dur, level: 0.07 });
        const at = 0.2 + dur;
        burst({ ms: 8, peak: 0.032, center: 1700, q: 1.8, at: at + 0.16, send: 0.25 });
        burst({ ms: 8, peak: 0.026, center: 1300, q: 1.8, at: at + 0.34, send: 0.25 });
        return at + 1.1;
      } },

    { tag: 'РАДАР', grp: 'работа дока', on: true, dur: 7.0,
      hint: 'установка гудит как трансформатор и шлёт импульсы вибрирующей электроэнергии',
      what: 'Сетевой гул 50 Гц с гармониками 100/150/200 и три-пять разрядов: кольцевая модуляция 38–70 Гц, тон рушится вниз, сверху треск',
      play() {
        // НИ ОДНОЙ НОТЫ. Владелец: «в радаре тоже тот же колокольчик — некрасиво, что он часто во
        // многих звуках. Радар должен гудеть как трансформатор и посылать импульсы вибрирующей
        // электроэнергии». Корень был не в выборе окраски: ЛЮБАЯ многосоставная нота с затуханием
        // читается ухом как колокольчик, чем её ни окрашивай. Поэтому нот здесь нет вовсе.
        const dur = rnd(5.5, 7.5);
        transformerHum({ at: 0, dur, level: 0.06 });
        const nn = 3 + Math.floor(Math.random() * 3);
        let at = rnd(0.5, 0.9);
        for (let i = 0; i < nn && at < dur - 0.5; i++) {
          zap({ at, dur: rnd(0.35, 0.7), level: rnd(0.07, 0.095) });
          at += rnd(1.0, 1.8);
        }
        return dur + 0.4;
      } },

    { tag: 'СКАНЕР', grp: 'работа дока', on: true, dur: 8.5,
      hint: 'три круга: пожужжал, попикал, пустил волну',
      what: 'Цикл «жужжание → две ноты → волна вверх», три раза, в конце длинное подтверждение',
      play() {
        let at = 0;
        const col = pick(['жужжащий', 'перегруз', 'стекло', 'вауканье']);
        for (let c = 0; c < 3; c++) {
          const bz = rnd(0.55, 0.95);
          amBuzz({ at, dur: bz, freq: rnd(180, 250), rate: rnd(26, 42), level: 0.06 });
          at += bz + 0.12;
          beep({ freq: PENTA_HI[c], peak: 0.10, len: 0.12, colour: col, at, send: 0.4 });
          beep({ freq: PENTA_HI[c + 2], peak: 0.10, len: 0.16, colour: col, at: at + 0.14, send: 0.4 });
          at += 0.42;
          const wv = rnd(0.9, 1.3);
          wave({ at, dur: wv, from: 240, to: 2800, level: 0.07 });
          at += wv + rnd(0.15, 0.45);
        }
        // СКАН ЗАВЕРШЁН — БЕЗ НОТ. Владелец услышал колокольчик и в стеклянной паре: причина не в
        // окраске, а в самой природе многосоставной затухающей ноты. Поэтому здесь закрывающая
        // волна ВНИЗ — зеркало испускающей — и два сухих щелчка. Луч свернулся, прибор молчит.
        wave({ at, dur: 0.9, from: 2600, to: 260, level: 0.06 });
        burst({ ms: 6, peak: 0.05, center: 2100, q: 2.4, at: at + 0.95, send: 0.2 });
        burst({ ms: 6, peak: 0.04, center: 1500, q: 2.4, at: at + 1.08, send: 0.2 });
        return at + 1.4;
      } },

    { tag: 'СВАРКА', grp: 'работа дока', on: true, dur: 11.0,
      hint: 'варят долго: несколько швов, между ними перехваты, в конце остужают',
      what: '3–5 швов дуги по 1–2,5 с с паузами, между ними стук перехвата; финал — шипение остывания и удар',
      play() {
        let at = 0;
        const seams = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < seams; i++) {
          const dur = rnd(1.0, 2.5);
          arc({ at, dur, level: rnd(0.07, 0.095) });
          at += dur;
          if (i < seams - 1) {
            at += rnd(0.3, 0.9);
            if (Math.random() < 0.6) { metal({ peak: 0.07, decay: 0.3, at, partials: [430, 980, 1620] }); at += rnd(0.2, 0.5); }
          }
        }
        at += 0.25;
        hiss({ at, dur: rnd(1.2, 2.0), level: 0.05 });
        metal({ peak: 0.10, decay: 0.55, at: at + rnd(0.6, 1.3) });
        return at + 2.4;
      } },

    { tag: 'КЛЮЧ', grp: 'работа дока', on: true, dur: 8.5,
      hint: 'пит-стоп: гайковёрт воет вжжжуу несколько раз, между заходами стучит молоток',
      what: 'Порядок как на пит-стопе: длинный вой на срыв, короткие добивки, между ними удары молотка и лязг колеса',
      play() {
        let at = 0;
        const runs = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < runs; i++) {
          // Первый заход ДЛИННЫЙ — срывают затянутую гайку; дальше короткие добивки. Порядок
          // не украшение: именно он читается ухом как «работают», а не «нажали кнопку три раза».
          const dur = i === 0 ? rnd(0.85, 1.35) : rnd(0.35, 0.7);
          pitGun({ at, dur, level: i === 0 ? 0.09 : 0.075 });
          at += dur;
          metal({ peak: 0.085, decay: 0.28, at: at + 0.02, partials: [300, 700, 1150] });   // гайка села
          at += rnd(0.3, 0.7);
          if (i < runs - 1) {
            const taps = 1 + Math.floor(Math.random() * 3);
            for (let k = 0; k < taps; k++) { metal({ peak: rnd(0.10, 0.15), decay: rnd(0.4, 0.7), at }); at += rnd(0.22, 0.4); }
            at += rnd(0.2, 0.5);
          }
        }
        metal({ peak: 0.13, decay: 0.8, at, partials: [240, 610, 1340, 2100] });             // колесо на место
        return at + 1.0;
      } },

    { tag: 'МАНИПУЛЯТОР', grp: 'работа дока', on: true, dur: 7.5,
      hint: 'машинная рука неспешно переставляется: приводы мягко разгоняются, долго тормозят, встают в позицию',
      what: 'Три-четыре неспешных хода: разгон и торможение занимают больше, чем полка, редуктор приглушён, в конце хода мягкий стук позиционирования',
      play() {
        let at = 0;
        // Ходов МЕНЬШЕ, каждый ДЛИННЕЕ, паузы между ними шире: рука перестаёт дёргаться и начинает
        // переставляться. Верхняя частота приводов опущена с 430 до 300 Гц — выше начинается писк.
        const moves = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < moves; i++) {
          const dur = rnd(0.7, 1.5);
          servo({ at, dur, top: rnd(150, 300), level: rnd(0.045, 0.07) });
          at += dur;
          // Иногда рука доводит позицию вторым, коротким и тихим ходом — так и работает механика.
          if (Math.random() < 0.3) { const d2 = rnd(0.3, 0.5); servo({ at: at + 0.18, dur: d2, top: rnd(170, 240), level: 0.038 }); at += 0.18 + d2; }
          at += rnd(0.6, 1.4);
        }
        return at;
      } },

    { tag: 'БОЛГАРКА', grp: 'работа дока', on: true, dur: 8.0,
      hint: 'режут металл: диск раскручивается до высокого воя, входит в рез, редкие искры',
      what: 'Раскрутка диска до ~2 кГц, два-три реза по 1–2,2 с: высокий ровный вой с просадкой под нагрузкой, узкий визг 3,5–5,5 кГц с быстрой мелкой модуляцией и редкие искры',
      play() {
        // Раскрутка диска — та же турбина, но короткая и высокая: это один и тот же класс машины,
        // и делать для неё второй кирпич значило бы разводить сущности (PHILOSOPHY.md, Оккам).
        // РАСКРУТКА ТЕПЕРЬ СВОЯ, а не турбина. Прежде я переиспользовал турбину «по Оккаму» —
        // и был неправ: Оккам действует внутри машинерии, но НЕ на том, что человек слышит
        // (PHILOSOPHY.md). Низкий тяжёлый разгон турбины и добавлял болгарке паровоза.
        grinder({ at: 0, dur: 0.9, level: 0.04, spinUp: true });
        let at = 0.85;
        const cuts = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < cuts; i++) {
          const dur = rnd(1.0, 2.2);
          grinder({ at, dur, level: rnd(0.042, 0.055) });
          at += dur + rnd(0.6, 1.3);
        }
        metal({ peak: 0.055, decay: 0.45, at, partials: [340, 820, 1460, 2300] });   // отрезанное упало
        return at + 0.9;
      } },

    { tag: 'ОБШИВКА', grp: 'работа дока', on: true, dur: 5.0,
      hint: 'ритм молотка: несколько ударов, пауза, ещё несколько',
      what: 'Две-три группы ударов по железу разной силы, между группами паузы',
      play() {
        let at = 0;
        const groups = 2 + Math.floor(Math.random() * 2);
        for (let g = 0; g < groups; g++) {
          const taps = 2 + Math.floor(Math.random() * 4);
          for (let k = 0; k < taps; k++) {
            metal({ peak: rnd(0.09, 0.16), decay: rnd(0.35, 0.8), at });
            at += rnd(0.19, 0.34);
          }
          at += rnd(0.5, 1.1);
        }
        return at;
      } },
  ];


  /* ===============================================================================================
     ПЛАНИРОВЩИК СЦЕН — наложения 50 %, не больше трёх голосов
     ===============================================================================================
     Два РАЗНЫХ ограничителя, и оба нужны. Вероятность решает, как часто следующая сцена входит, не
     дождавшись конца предыдущей. Потолок в три голоса жёсткий: он не даёт редким совпадениям
     сложиться в кучу, даже если случай выпал трижды подряд. Одной вероятности мало — она
     ограничивает среднее, а слышно пик.

     Заход — в ПЕРВУЮ ПОЛОВИНУ сцены, а не в её хвост: иначе, даже когда случай выпадает, ухо
     слышит не два процесса разом, а стык. На стенде первая редакция входила в хвост при 20 %, и
     владелец справедливо сказал, что наложений нет вовсе. */
  const MAX_TOGETHER = 3;
  const OVERLAP_PCT = 50;          // слово владельца
  const MEAN_GAP_MS = 3000;
  let active = 0, sceneTimer = null, melTimer = null, chordTimer = null;
  let onMove = () => {};

  function nextGap() { return Math.max(400, -Math.log(Math.max(1e-6, Math.random())) * MEAN_GAP_MS); }

  function startScene() {
    const live = SCENES.filter((v) => v.on);
    if (!live.length) return 0;
    const v = pick(live);
    const ms = (v.play() || v.dur) * 1000;
    active += 1;
    setTimeout(() => { active = Math.max(0, active - 1); }, ms);
    return ms;
  }

  function tickScene() {
    if (!soundOn || !workOn) { sceneTimer = setTimeout(tickScene, 700); return; }
    let waitMs;
    if (active >= MAX_TOGETHER) waitMs = 700;
    else {
      const ms = startScene();
      waitMs = (Math.random() * 100 < OVERLAP_PCT) ? Math.max(350, ms * rnd(0.05, 0.45)) : ms + nextGap();
    }
    sceneTimer = setTimeout(tickScene, Math.max(300, waitMs));
  }

  /* ===============================================================================================
     ЗВУКОВОЙ ГРАФ И ВНЕШНИЙ ИНТЕРФЕЙС
     =============================================================================================== */

  /* ПОЛНАЯ ГРОМКОСТЬ — одно число, а не литерал в двух местах: подача (`fadeIn`) обязана приходить
     ровно к той величине, которую ставит сборка графа, иначе плавный подъём кончается скачком. */
  const MASTER_GAIN = 0.95;

  function build() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    // ЛИМИТЕР: громкость максимальная и регулятора нет (слово владельца), значит сумма голосов
    // обязана не перегружать выход сама. Порог −10 при ratio 20 — это потолок, а не компрессор:
    // прежние −6/12 сумму вдвое выше порога пригибали, но не держали, и на пиках был слышен хрип.
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 2; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.14;
    lim.connect(ac.destination);
    master = ac.createGain(); master.gain.value = MASTER_GAIN; master.connect(lim);
    verb = reverb(); const vg = ac.createGain(); vg.gain.value = 0.9;
    verb.connect(vg); vg.connect(master);
    melBus = ac.createGain(); melBus.gain.value = 1.0; melBus.connect(master);
    padBus = ac.createGain(); padBus.gain.value = 1.0; padBus.connect(master);
    blipBus = ac.createGain(); blipBus.gain.value = 1.0; blipBus.connect(master);
    armed = true;
  }

  /** @param {{instant?:boolean}} [o] — `instant` при СМЕНЕ ТЕМЫ: очередь отдаётся сразу. */
  function stopTheme(o) {
    clearTimeout(melTimer); melTimer = null;
    clearInterval(chordTimer); chordTimer = null;
    if (padVoice) { padVoice.stop(o && o.instant ? 0.1 : 3.0); padVoice = null; }
    trackStop();
  }

  function startTheme() {
    if (!armed || !soundOn || melIdx < 0) return;
    // Записанная тема написана целиком: ни аккордов под ней, ни цикла ходов, ни фраз.
    if (melIdx === TRACK_INDEX) { trackStart(); onMove(TRACK.name + ' · играет по кругу'); return; }
    moveIdx = 0; chordStep = 0; rollChord();
    chordTimer = setInterval(rollChord, 20 * BEAT * 1000);   // 20 ДОЛЕЙ, а не круглые секунды:
    playPhrase();                                            // иначе аккорд разъедется с фразами
  }

  return {
    /** Есть ли уже разрешение от человека (браузер без него звучать не даёт). */
    get armed() { return armed; },
    get on() { return soundOn; },
    get theme() { return melIdx; },
    get work() { return workOn; },

    /* -----------------------------------------------------------------------------------------------
       ЗВУЧИТ ЛИ ОН НА САМОМ ДЕЛЕ — отдельный факт от «включён».
       -----------------------------------------------------------------------------------------------
       `on` это НАМЕРЕНИЕ страницы, а `running` — состояние железа звука. Они расходятся ровно в том
       случае, ради которого этот геттер и заведён: окно поднято автозапуском, страница честно
       позвала `toggle(true)`, а браузер оставил контекст усыплённым, потому что человек ещё ничего
       не щёлкнул. Без раздельных фактов кнопка сказала бы «ЗВУК ВКЛ» в полной тишине — это
       ровно тот класс, за который проект уже платил (`bugs/27`: связь считалась живой, пока не
       спросили сам транспорт). */
    get running() { return armed && !!ac && ac.state === 'running'; },

    /** Разбудить усыплённый контекст. Возвращает обещание, потому что браузер отвечает не сразу. */
    resume() {
      if (!armed) build();
      try { return Promise.resolve(ac.resume()).then(() => ac.state === 'running'); }
      catch (e) { return Promise.resolve(false); }
    },

    /* ПЛАВНАЯ ПОДАЧА, слово владельца 2026-08-22: «плавно за 20 секунд нарастает по громкости от 0
       до 100 %». Полторы минуты стоять рядом с внезапно заоравшим ремонтным доком — не то, что
       нужно человеку, который только что запустил прогон и ещё держит руку на мыши.
       Подача идёт по САМОМУ ГРОМКОМУ узлу (master), а не по отдельным шинам: тогда она одинаково
       накрывает и тему, и рабочие сцены, чем бы из них ни начался цикл. */
    fadeIn(seconds = 20) {
      if (!armed) build();
      const sec = Math.max(0.05, Number(seconds) || 0);
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.0001, t);      // не ноль: экспоненте ноль запрещён, а линейной он
      master.gain.linearRampToValueAtTime(MASTER_GAIN, t + sec);   // просто не нужен — старт неслышим
      return sec;
    },

    /** Текущая громкость общего узла — чтобы подачу можно было ПРОВЕРИТЬ, а не обсуждать. */
    gainNow() { return armed && master ? master.gain.value : 0; },
    get fullGain() { return MASTER_GAIN; },

    /** Включить/выключить звук целиком. Первый вызов и есть то самое разрешение браузера. */
    toggle(on) {
      if (!armed) build();
      soundOn = on === undefined ? !soundOn : !!on;
      if (soundOn) { startTheme(); if (!sceneTimer) tickScene(); }
      else { stopTheme(); clearTimeout(sceneTimer); sceneTimer = null; }
      return soundOn;
    },

    /** Тема: 3 · Глубокий космос (запись, по умолчанию), 0 · Маяк, 1 · Дрейф, 2 · Позывной, −1 · выкл.
     *  СМЕНА ТЕМЫ МГНОВЕННА — слово владельца: «предыдущая должна мгновенно замолкать, отдавать
     *  очередь новой». Поэтому здесь `instant`, а не обычный трёхсекундный уход подложки: тот
     *  уместен между аккордами ОДНОЙ темы, но при смене темы он наложил бы старую на новую. */
    setTheme(i) {
      melIdx = Number(i);
      stopTheme({ instant: true });
      if (soundOn) startTheme();
    },
    get trackIndex() { return TRACK_INDEX; },

    /** Рабочие звуки дока — отдельным выключателем, слово владельца. */
    setWork(on) { workOn = !!on; },

    /** Кому сообщать текущий ход цикла темы (для надписи на странице). */
    onMove(fn) { onMove = typeof fn === 'function' ? fn : () => {}; },

    themes: MELODIES.map((m) => ({ name: m.name, contour: m.contour, what: m.what })),
    /** Записанная тема отдаётся ОТДЕЛЬНО от `themes`: там индекс — это положение в массиве, и
     *  дописать её туда четвёртой значило бы сказать «её индекс 3» дважды, в двух местах. */
    track: () => ({ name: TRACK.name, what: TRACK.what, index: TRACK_INDEX, url: TRACK.url }),

    /* ---------------------------------------------------------------------------------------------
       СТЕНДОВЫЙ ИНТЕРФЕЙС. Он здесь не «на всякий случай»: без него стенд прослушивания вынужден
       держать ВТОРУЮ КОПИЮ движка, а пара «правда↔зеркало» — то, за что этот проект уже платил
       (R16c, EXP-0077). Пять строк доступа дешевле, чем восемьсот строк, расходящиеся при каждой
       правке звука. Продакшен-путь ими не пользуется.
       --------------------------------------------------------------------------------------------- */
    scenes: () => SCENES.map((v) => ({ tag: v.tag, grp: v.grp, hint: v.hint, what: v.what, on: v.on, dur: v.dur })),
    playScene(tag) {
      if (!armed) build();
      const v = SCENES.find((x) => x.tag === tag);
      return v ? (v.play() || v.dur) * 1000 : 0;
    },
    setSceneOn(tag, on) { const v = SCENES.find((x) => x.tag === tag); if (v) v.on = !!on; },
    activeCount: () => active,
    /** Устроить наложение прямо сейчас — чтобы механизм можно было ПРОВЕРИТЬ, а не обсуждать. */
    forceOverlap() {
      if (!armed) build();
      const nn = Math.min(MAX_TOGETHER - active, 2 + Math.floor(Math.random() * 2));
      for (let i = 0; i < nn; i++) setTimeout(() => { if (active < MAX_TOGETHER) startScene(); }, i * rnd(150, 700));
    },
    /** Темп темы. Открытый вопрос №1 из `researches/12` — отвечать на него ухом владельца. */
    setBpm(bpm) { BEAT = 60 / Number(bpm); },
    get bpm() { return Math.round(60 / BEAT); },
  };
})();
