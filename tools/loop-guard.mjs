#!/usr/bin/env node
// tools/loop-guard.mjs — ВНЕШНИЙ СТОРОЖ ЗАЩИЩЁННОГО ЦИКЛА (слой 2 скилла /guarded-loop).
//
// ЗАЧЕМ ОН ЕСТЬ. Скилл /guarded-loop требует ДВА слоя охраны: будильники самой оболочки (слой 1) и
// МЕСТНЫЙ механизм ОС (слой 2), который живёт ОТДЕЛЬНЫМ процессом и потому может заметить то, чего
// зависший агент про себя заметить не может — что агент замолчал. Защищённые циклы сессий 61 и 62
// шли БЕЗ слоя 2: пока ничего не зависало, дыры не было видно. Сторож закрывает ровно её.
//
// ЧТО ОН ДЕЛАЕТ. Раз в --check-every секунд смотрит ВОЗРАСТ последней строки .kaif/heartbeat.log.
// Пульс пишется только по завершении шага (канон скилла), поэтому его возраст — это возраст
// последней СДЕЛАННОЙ работы, а не «жив ли процесс».
//
// ПОРОГИ ВЫВЕДЕНЫ ИЗ ЗАМЕРА, НЕ ИЗ ГОЛОВЫ (канон: «не выдумывать пороги»).
//   Замер 2026-08-29 18:0x по .kaif/heartbeat.log: n=7 зазоров, медиана 3,0 мин, МАКСИМУМ 4,7 мин.
//   --stale-after 900 с = 3× измеренного максимума. --debounce 2 — тревога только после ДВУХ
//   несвежих проверок подряд (длинная сборка законно молчит). Итог: тревога не раньше ~20 мин
//   настоящей тишины. ⚠️ Выборка одного окна, n=7 — порог НОМИНАЛЬНЫЙ, пересмотреть при большем
//   архиве. Слабость названа здесь, а не спрятана.
//
// ГРАНИЦЫ. Сторож НИЧЕГО не перезапускает и ничего не убивает: он ГОВОРИТ — пишет строку тревоги в
// .kaif/loop-guard.log и зовёт владельца всплывающим уведомлением. Перезапуск агента из скрипта —
// это право, которого у машинерии нет (агент себе прав не поднимает, `grant-agent-rights.mjs`), а
// молчаливый убийца процессов в автономном окне — худший из возможных сторожей.
//
// САМОРАЗОРУЖЕНИЕ. --until <ISO> обязателен: сторож, переживший свой прогон, — заряженное ружьё
// (канон скилла). Дойдя до срока, он пишет «разоружён» и выходит сам. Одиночность — файл-замок с
// пид; второй экземпляр отказывается стартовать и говорит, кто держит.
//
// [ПРОВЕРЕНО: 2026-08-29 18:1x · --selftest — семь блоков: свежий пульс молчит · пустой журнал не
//  тревога · берётся последняя метка · дребезг копится и сбрасывается · тревога ровно на границе.]

import { appendFileSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEARTBEAT = path.join(ROOT, '.kaif', 'heartbeat.log');
const GUARD_LOG = path.join(ROOT, '.kaif', 'loop-guard.log');
const LOCK = path.join(ROOT, '.kaif', 'loop-guard.lock');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const stampNow = () => {
  const d = new Date(), p = (x) => String(x).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sg = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sg}${p(Math.floor(a / 60))}${p(a % 60)}`;
};

const say = (line) => {
  const s = `${stampNow()} | ${line}`;
  appendFileSync(GUARD_LOG, s + '\n', 'utf8');
  console.log(s);
};

// Возраст последней строки пульса в минутах. Читаем МЕТКУ строки, а не mtime файла: mtime врёт,
// если кто-то тронул файл, не дописав работы.
export function pulseAgeMinutes(text, nowMs) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2})(\d{2})/);
    if (!m) continue;
    const t = new Date(`${m[1]}${m[2]}:${m[3]}`).getTime();
    if (Number.isFinite(t)) return (nowMs - t) / 60000;
  }
  return null; // ни одной строки с меткой — молчим, это не тревога, а пустой журнал
}

// Чистое ядро решения: сколько несвежих проверок подряд накопилось и пора ли кричать.
export function decide({ ageMin, staleAfterMin, streak, debounce }) {
  if (ageMin === null || ageMin <= staleAfterMin) return { streak: 0, alarm: false };
  const next = streak + 1;
  return { streak: next, alarm: next === debounce }; // ровно НА границе, не после — иначе спам
}

function notifyOwner(text) {
  // Всплывающее уведомление владельцу. Тихо переживает отсутствие тостов — сторож, падающий на
  // собственном крике, хуже молчащего.
  const ps = "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');"
    + '$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Warning;'
    + `$n.Visible=$true;$n.ShowBalloonTip(20000,'KAGO: цикл замолчал',${JSON.stringify(text)},'Warning');`
    + 'Start-Sleep -Seconds 6;$n.Dispose()';
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000 });
  } catch { /* см. границы выше */ }
}

function selftest() {
  let ok = 0, bad = 0;
  const t = (name, cond) => { if (cond) { ok++; console.log(`  ✅ ${name}`); } else { bad++; console.log(`  ❌ ${name}`); } };
  console.log('САМОПРОВЕРКА loop-guard — возраст пульса и дребезг тревоги; ни файлов, ни процессов, ни часов');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: дребезг · выбор ПОСЛЕДНЕЙ метки · пустой журнал не тревога');
  const now = new Date('2026-08-29T18:00:00+03:00').getTime();
  t('свежий пульс: возраст мал', Math.abs(pulseAgeMinutes('2026-08-29T17:58:00+0300 | шаг | done | next: X', now) - 2) < 0.01);
  t('пустой журнал: возраста нет', pulseAgeMinutes('', now) === null);
  t('берётся ПОСЛЕДНЯЯ строка с меткой', Math.abs(pulseAgeMinutes('2026-08-29T10:00:00+0300 a\n2026-08-29T17:50:00+0300 b', now) - 10) < 0.01);
  t('свежий пульс сбрасывает дребезг', decide({ ageMin: 3, staleAfterMin: 15, streak: 1, debounce: 2 }).streak === 0);
  t('первая несвежая — молчит', decide({ ageMin: 20, staleAfterMin: 15, streak: 0, debounce: 2 }).alarm === false);
  t('вторая несвежая — ТРЕВОГА', decide({ ageMin: 20, staleAfterMin: 15, streak: 1, debounce: 2 }).alarm === true);
  t('третья несвежая — НЕ повторяет тревогу', decide({ ageMin: 20, staleAfterMin: 15, streak: 2, debounce: 2 }).alarm === false);
  console.log(`ИТОГ: блоков ${ok + bad}, зелёных ${ok}, красных ${bad}`);
  process.exit(bad ? 1 : 0);
}

if (has('--selftest')) selftest();

const until = flag('--until', null);
if (!until) { console.error('ПРОВАЛ: --until <ISO> обязателен — сторож без срока не разоружается сам.'); process.exit(2); }
const untilMs = new Date(until).getTime();
if (!Number.isFinite(untilMs)) { console.error(`ПРОВАЛ: не разобрал срок "${until}".`); process.exit(2); }

const checkEvery = Number(flag('--check-every', '300')) * 1000;
const staleAfter = Number(flag('--stale-after', '900')) / 60;
const debounce = Number(flag('--debounce', '2'));

if (existsSync(LOCK)) {
  const held = readFileSync(LOCK, 'utf8').trim();
  const pid = Number(held.split('|')[0]);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  if (alive) { console.error(`ПРОВАЛ: сторож уже сторожит — ${held}. Двух не бывает.`); process.exit(3); }
  say(`замок был осиротевшим (пид ${pid} мёртв) — перехватываю`);
}
writeFileSync(LOCK, `${process.pid}|до ${until}`, 'utf8');
const disarm = () => { try { unlinkSync(LOCK); } catch { /* уже снят */ } };
process.on('exit', disarm);
process.on('SIGINT', () => { say('прерван сигналом — разоружаюсь'); process.exit(0); });

say(`ВЗВЕДЁН: проверка раз в ${checkEvery / 1000} с · тишина > ${staleAfter} мин · дребезг ${debounce} · до ${until}`);

let streak = 0;
const tick = () => {
  const now = Date.now();
  if (now >= untilMs) { say('срок вышел — РАЗОРУЖЁН сам'); disarm(); process.exit(0); }
  const text = existsSync(HEARTBEAT) ? readFileSync(HEARTBEAT, 'utf8') : '';
  const age = pulseAgeMinutes(text, now);
  const d = decide({ ageMin: age, staleAfterMin: staleAfter, streak, debounce });
  streak = d.streak;
  if (d.alarm) {
    const msg = `цикл молчит ${age.toFixed(1)} мин (порог ${staleAfter}, дребезг ${debounce}) — агент, возможно, завис`;
    say(`🔴 ТРЕВОГА: ${msg}`);
    notifyOwner(msg);
  }
  setTimeout(tick, checkEvery);
};
setTimeout(tick, checkEvery);
