#!/usr/bin/env node
// tools/build-area-card.mjs — «площадь под кривой против стока» кадрами 16:9 (PNG, RU и EN) для витрины GitHub.
//
// ЗАЧЕМ. Владелец 2026-10-17 17:1x: «возьми интеграл от стоковой кривой, и он нашей» → инфографика 17:58, его слово 18:0x:
// «ИНФОГРАФИКА ОХУЕННЕЙШАЯ… ЭТО МОЖНО НА РУ И АНГЛ ЯЗЫКИ, КАДРАМИ 16к9 И В GH в README отправлять».
//
// РЕШЕНИЯ — те же, что у `build-comparison-card.mjs` (сосед по витрине): числа НЕ набираются руками — площадь считает
// `curve-area.curveArea` по снимку кривой, которым стоит режим; кегль задан, а не подогнан (кадр читается с телефона);
// тёмная тема; ноль новых зависимостей — кадр снимает установленный браузер `--headless --screenshot`.
// Два кадра на язык: 1 — числа и глубина понижения (площадь под ней = выигранный интеграл); 2 — две кривые и полосы.
//
// GPU WRITES: NONE. Читает снимок кривой и профиль, пишет HTML и PNG в `assets/area/`.
//
//   node tools/build-area-card.mjs [--snapshot <id>]   по умолчанию — снимок, на котором стоит profiles/optimised.json
//   node tools/build-area-card.mjs --help
//
// [TESTED: 2026-10-17 · собраны 4 кадра со снимка 2026-10-17T17-54-57, каждый открыт глазами (Read по PNG) до коммита]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { curveArea } from './curve-area.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'area');
const W = 1920; const H = 1080;
const BAND_EDGES = [2157, 2500, 2700, 2800, 2900, 2950];

const T = {
  ru: {
    t1: 'Сколько площади под заводской кривой выиграл KAGO', t2: 'Заводская кривая и наша',
    sub: (d) => `⚖️ Optimised · GeForce RTX 5070 Ti · драйвер ${d} · кривая «частота → напряжение», 389 частот, 180…3090 МГц`,
    won: 'выиграно площади', pct: 'от заводской площади', mean: 'в среднем по всем частотам', max: 'наибольшее понижение',
    depth: 'Глубина понижения: заводская − наша, мВ', depthCap: 'Площадь под этой линией — выигранный интеграл',
    stock: 'заводская', ours: 'наша', bands: 'Выигрыш по полосам частот', mhz: 'МГц', mv: 'мВ', vmhz: 'В·МГц',
    below: 'ниже 2157', above: 'выше 2950', foot: 'Интеграл трапециями по сетке частот карты. KAGO — Криника Автоматизированный ГПУ Оркестратор',
  },
  en: {
    t1: 'How much area under the factory curve KAGO has won', t2: 'The factory curve and ours',
    sub: (d) => `⚖️ Optimised · GeForce RTX 5070 Ti · driver ${d} · the frequency → voltage curve, 389 frequencies, 180…3090 MHz`,
    won: 'area won', pct: 'of the factory area', mean: 'mean across all frequencies', max: 'largest single drop',
    depth: 'How deep we undervolt: factory − ours, mV', depthCap: 'The area under this line is the integral we won',
    stock: 'factory', ours: 'ours', bands: 'Area won per frequency band', mhz: 'MHz', mv: 'mV', vmhz: 'V·MHz',
    below: 'below 2157', above: 'above 2950', foot: 'Trapezoid integral over the card\'s frequency ladder. KAGO — Krinik Automated GPU Orchestrator',
  },
};

const num = (lang, x, d = 1) => (lang === 'ru' ? x.toFixed(d).replace('.', ',') : x.toFixed(d));
const nb = (s) => s.replace(/ (В·МГц|V·MHz|мВ|mV|%|МГц|MHz)/g, '\u00a0$1');

/** An x/y plot frame as SVG pieces: grid lines, y labels, x labels, dashed band edges. */
function axes(xs, ys, yTicks, m, w, h, lang) {
  let g = '';
  for (const t of yTicks) g += `<line x1="${m.l}" x2="${w - m.r}" y1="${ys(t)}" y2="${ys(t)}" stroke="#2c2c2a"/><text x="${m.l - 12}" y="${ys(t) + 8}" class="ax" text-anchor="end">${t}</text>`;
  for (const f of [500, 1000, 1500, 2000, 2500, 3000]) g += `<text x="${xs(f)}" y="${h - m.b + 34}" class="ax" text-anchor="middle">${f}</text>`;
  for (const b of BAND_EDGES) g += `<line x1="${xs(b)}" x2="${xs(b)}" y1="${m.t}" y2="${h - m.b}" stroke="#3a3a37" stroke-dasharray="6 6"/>`;
  g += `<text x="${m.l - 12}" y="${h - m.b + 34}" class="ax" text-anchor="end">${T[lang].mhz}</text>`;
  return g;
}

function frame(lang, n, a, pts, driver, logo) {
  const L = T[lang];
  const css = `*{box-sizing:border-box}body{margin:0;width:${W}px;height:${H}px;background:#0d0d0d;color:#f0efec;font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden}
.wrap{padding:56px 72px 0}.head{display:flex;align-items:center;gap:28px}.head img{width:96px;height:96px}
h1{font-size:54px;margin:0;letter-spacing:-.5px;line-height:1.1}.sub{font-size:24px;color:#c3c2b7;margin:10px 0 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:36px 0 26px}.tile{background:#1a1a19;border-radius:16px;padding:22px 26px}
.tile b{display:block;font-size:62px;font-weight:700;letter-spacing:-1px;white-space:nowrap}.tile span{font-size:22px;color:#c3c2b7}
.panel{background:#1a1a19;border-radius:16px;padding:22px 26px}.panel h2{font-size:30px;margin:0}.panel p{font-size:21px;color:#c3c2b7;margin:4px 0 8px}
.ax{fill:#8d8c86;font-size:22px}.foot{position:absolute;left:72px;right:72px;bottom:26px;font-size:19px;color:#8d8c86}
.two{display:grid;grid-template-columns:1.45fr 1fr;gap:20px;margin-top:30px}.bar{display:grid;grid-template-columns:150px 1fr 230px;align-items:center;gap:14px;margin:38px 0;font-size:26px}
.bar .t{height:26px;border-radius:0 6px 6px 0;background:#3987e5}.bar .l{color:#c3c2b7}.bar .v{white-space:nowrap}
.leg{font-size:23px;color:#c3c2b7;margin:6px 0}.leg i{display:inline-block;width:30px;height:5px;border-radius:3px;vertical-align:middle;margin:0 10px 0 0}`;
  const head = `<div class="head"><img src="${logo}" alt=""><div><h1>${n === 1 ? L.t1 : L.t2}</h1><p class="sub">${L.sub(driver)}</p></div></div>`;
  let body;
  if (n === 1) {
    const w = 1776; const h = 520; const m = { l: 70, r: 16, t: 16, b: 46 };
    const xs = (f) => m.l + ((f - 180) / (3090 - 180)) * (w - m.l - m.r); const ys = (d) => h - m.b - (d / 200) * (h - m.t - m.b);
    const line = pts.map((q, i) => `${i ? 'L' : 'M'}${xs(q.f).toFixed(1)} ${ys(q.s - q.v).toFixed(1)}`).join(' ');
    const svg = `<svg width="${w - 52}" viewBox="0 0 ${w} ${h}">${axes(xs, ys, [0, 50, 100, 150, 200], m, w, h, lang)}
<path d="${line} L${xs(3090)} ${ys(0)} L${xs(180)} ${ys(0)} Z" fill="rgba(57,135,229,.24)"/><path d="${line}" fill="none" stroke="#3987e5" stroke-width="4"/></svg>`;
    body = `<div class="tiles">
<div class="tile"><b>${nb(`${num(lang, a.whole.won)} ${L.vmhz}`)}</b><span>${L.won}</span></div>
<div class="tile"><b>${nb(`${num(lang, a.whole.wonPct, 2)} %`)}</b><span>${L.pct}</span></div>
<div class="tile"><b>${nb(`−${num(lang, a.whole.meanMv)} ${L.mv}`)}</b><span>${L.mean}</span></div>
<div class="tile"><b>${nb(`−${a.maxDropMv} ${L.mv}`)}</b><span>${L.max}</span></div></div>
<div class="panel"><h2>${L.depth}</h2><p>${L.depthCap}</p>${svg}</div>`;
  } else {
    const w = 1060; const h = 700; const m = { l: 80, r: 16, t: 16, b: 46 };
    const vis = pts.filter((q) => q.s >= 700);
    const xs = (f) => m.l + ((f - 180) / (3090 - 180)) * (w - m.l - m.r); const ys = (v) => h - m.b - ((v - 700) / (1250 - 700)) * (h - m.t - m.b);
    const P = (k) => vis.map((q, i) => `${i ? 'L' : 'M'}${xs(q.f).toFixed(1)} ${ys(q[k]).toFixed(1)}`).join(' ');
    const back = [...vis].reverse().map((q) => `L${xs(q.f).toFixed(1)} ${ys(q.v).toFixed(1)}`).join(' ');
    const last = vis.at(-1);
    const svg = `<svg width="${w - 52}" viewBox="0 0 ${w} ${h}">${axes(xs, ys, [700, 800, 900, 1000, 1100, 1200], m, w, h, lang)}
<path d="${P('s')} ${back} Z" fill="rgba(57,135,229,.24)"/><path d="${P('s')}" fill="none" stroke="#d95926" stroke-width="4"/><path d="${P('v')}" fill="none" stroke="#3987e5" stroke-width="4"/>
<text x="${xs(last.f) - 8}" y="${ys(last.s) - 12}" class="ax" text-anchor="end" style="fill:#c3c2b7">${L.stock}</text><text x="${xs(last.f) - 8}" y="${ys(last.v) + 30}" class="ax" text-anchor="end" style="fill:#c3c2b7">${L.ours}</text>
<text x="${m.l + 10}" y="${m.t + 22}" class="ax">${L.mv}</text></svg>`;
    const max = Math.max(...a.bands.map((b) => b.wonPct));
    const name = (b) => (b.name === 'ниже 2157' ? L.below : b.name === 'выше 2950' ? L.above : b.name);
    const bars = a.bands.map((b) => `<div class="bar"><span class="l">${name(b)}</span><div class="t" style="width:${((b.wonPct / max) * 100).toFixed(1)}%"></div><span class="v">${nb(`${num(lang, b.wonPct, 1)} % · −${num(lang, b.meanMv, 0)} ${L.mv}`)}</span></div>`).join('');
    body = `<div class="two"><div class="panel"><div class="leg"><i style="background:#d95926"></i>${L.stock} &nbsp;&nbsp; <i style="background:#3987e5"></i>${L.ours} (Optimised)</div>${svg}</div>
<div class="panel"><h2>${L.bands}</h2>${bars}</div></div>`;
  }
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap">${head}${body}</div><div class="foot">${L.foot}</div></body></html>`;
}

function browser() {
  const c = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
  return c.find((p) => existsSync(p)) ?? null;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('node tools/build-area-card.mjs [--snapshot <id>] — кадры 16:9 «площадь под кривой против стока», RU и EN, в assets/area/ (карта не трогается)');
    return 0;
  }
  const i = argv.indexOf('--snapshot');
  const profile = JSON.parse(readFileSync(join(ROOT, 'profiles', 'optimised.json'), 'utf8'));
  const id = i >= 0 ? argv[i + 1] : profile.settings.curveSnapshot;
  const snapFile = join(ROOT, 'curves', 'battle', `${id}.json`);
  if (!existsSync(snapFile)) { console.error(`ОШИБКА: снимка ${id} нет`); return 1; }
  const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
  const a = curveArea(snap.frequencies);
  const pts = [...snap.frequencies].sort((x, y) => x.mhz - y.mhz).map((r) => ({ f: r.mhz, s: r.stockVoltageMv, v: r.voltageMv }));
  const logo = `data:image/png;base64,${readFileSync(join(ROOT, 'assets', 'logo', 'kago-logo.png')).toString('base64')}`;
  const exe = browser();
  if (!exe) { console.error('ОШИБКА: не найден Chrome или Edge для снимка кадра'); return 1; }
  mkdirSync(OUT, { recursive: true }); mkdirSync(join(ROOT, 'runs', 'area'), { recursive: true });
  for (const lang of ['ru', 'en']) for (const n of [1, 2]) {
    const html = join(ROOT, 'runs', 'area', `area-${lang}-${n}.html`); const png = join(OUT, `area-${lang}-${n}.png`);
    writeFileSync(html, frame(lang, n, a, pts, profile.stamp.driver, logo));
    const r = spawnSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, `--screenshot=${png}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000 });
    if (!existsSync(png)) { console.error(`ОШИБКА: кадр ${png} не снят — ${r.stderr ?? r.error}`); return 1; }
    console.log(`кадр ${png.replace(/\\/g, '/')}`);
  }
  console.log(`снимок ${id}: выиграно ${a.whole.won.toFixed(1)} В·МГц = ${a.whole.wonPct.toFixed(2)} %`);
  return 0;
}

// СТОРОЖ ВХОДА — исполняется только как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
