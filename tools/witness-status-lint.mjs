// witness-status-lint.mjs — МЕТКА СТРОКИ И ЕЁ СОБСТВЕННЫЙ СВИДЕТЕЛЬ НЕ МОГУТ ГОВОРИТЬ РАЗНОЕ.
//
// `bugs/115` AC3. Класс возвращался ЧЕТЫРЕ раза: 2026-08-17 (54 строки), 2026-08-23 (ось «карта не
// отдала»), 2026-09-08 (42 строки, `bugs/115`), 2026-09-08 (счётчик сводки, `bugs/116`). Каждый раз
// чинили ПИШУЩУЮ сторону и не трогали УЖЕ НАПИСАННОЕ — а читают документ.
//
// ЧТО СУДИТСЯ. Только то, что свидетель говорит ПРЯМО, своими словами:
//   «остановлено НАШИМ потолком глубины …»  → строка обязана нести `stop:depth-capped`
//   «глубже рычаг не достаёт»               → строка обязана нести `stop:lever-limited`
// Всё остальное НЕ СУДИТСЯ вовсе. Сторож, угадывающий смысл свидетеля, был бы третьим мнением о
// том же факте — ровно та болезнь, которую он лечит.
//
// ДОЛГ. Сегодня в боевом документе 42 расхождения, и это ПРАВДА, а не дефект сторожа: строки
// закрыты нашим потолком глубины, а помечены пределом сдвига, и владелец решил их ПЕРЕПРОЖЕЧЬ
// (`bugs/115` AC4, вариант Б), а не переклеить метку. Пока перепрожиг не сделан, они держатся в
// базе долга: новое расхождение валит сборку, старое терпится и обязано убывать.
//
// [TESTED: 2026-09-08 · боевой документ: СУДИМЫХ строк 54, расхождений 42, все заморожены в базу
//  долга; --selftest 7/7 на фикстурах, настоящий документ батареей не читается]
//
// ⚠️ В первой редакции этой метки стояло «85 строк» — число прикидочного скрипта, который считал
// все строки со статусом и свидетелем. Прибор судит только тех, чей свидетель говорит ПРЯМО, и
// таких 54. Прибор прав; метка исправлена по его прогону.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CURVE = join(ROOT, 'curves', 'measured.json');
export const BASELINE = join(ROOT, 'decisions', 'witness-status-baseline.json');

/** Что свидетель говорит ПРЯМО. `null` — не говорит ничего судимого, и это законно. */
export function statusFromWitness(provenBy) {
  const w = String(provenBy ?? '');
  if (w.includes('остановлено НАШИМ потолком глубины')) return 'stop:depth-capped';
  if (w.includes('глубже рычаг не достаёт')) return 'stop:lever-limited';
  return null;
}

/** Метка остановки строки. `null` — метки нет, судить нечего. */
export function statusOfRow(row) {
  return (row.tags ?? []).find((t) => String(t).startsWith('stop:')) ?? null;
}

/** Расхождения в документе: строка, её метка и то, что говорит её собственный свидетель. */
export function disagreements(doc) {
  const out = [];
  let judged = 0;
  for (const row of doc.frequencies ?? []) {
    const said = statusFromWitness(row.provenBy);
    const tag = statusOfRow(row);
    if (said === null || tag === null) continue;
    judged += 1;
    if (said !== tag) out.push({ mhz: row.mhz, tag, witness: said });
  }
  return { judged, rows: out };
}

export function readBaseline(path = BASELINE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { frozenAt: null, frequencies: [] }; }
}

export function writeBaseline(freqs, { path = BASELINE, at = new Date().toISOString() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ frozenAt: at, frequencies: [...freqs].sort((a, b) => b - a) }, null, 2)}\n`, 'utf8');
}

/**
 * Суд. Четыре списка, ни один не выводится из другого — форма сторожа справки (`bugs/95`):
 *   fresh   — расходится и НЕ в базе → валит сборку;
 *   debt    — расходится и в базе → терпится, обязано убывать;
 *   stale   — в базе, но строка уже согласна → валит: базу обязаны подрезать;
 *   missing — в базе, а такой судимой строки в документе нет → валит: база врёт.
 */
export function judge({ doc, baseline = readBaseline() } = {}) {
  const { judged, rows } = disagreements(doc);
  const base = new Set(baseline.frequencies ?? []);
  const bad = new Map(rows.map((r) => [r.mhz, r]));
  const fresh = rows.filter((r) => !base.has(r.mhz));
  const debt = rows.filter((r) => base.has(r.mhz));
  const judgedMhz = new Set((doc.frequencies ?? [])
    .filter((r) => statusFromWitness(r.provenBy) !== null && statusOfRow(r) !== null)
    .map((r) => r.mhz));
  const stale = [...base].filter((m) => judgedMhz.has(m) && !bad.has(m));
  const missing = [...base].filter((m) => !judgedMhz.has(m));
  return { judged, fresh, debt, stale, missing };
}

export function verdict(r) {
  return r.fresh.length === 0 && r.stale.length === 0 && r.missing.length === 0 ? 0 : 1;
}

function run(argv) {
  const doc = JSON.parse(readFileSync(CURVE, 'utf8'));
  if (argv.includes('--freeze')) {
    const { rows } = disagreements(doc);
    writeBaseline(rows.map((r) => r.mhz));
    console.log(`База долга заморожена: ${rows.length} строк(и) в ${relative(ROOT, BASELINE)}`);
    return 0;
  }
  const r = judge({ doc });
  console.log(`СТОРОЖ СВИДЕТЕЛЯ (bugs/115 AC3): судимых строк ${r.judged} · расхождений ${r.fresh.length + r.debt.length}`
    + ` · новых ${r.fresh.length} · в долге ${r.debt.length}`);
  for (const f of r.fresh) {
    console.log(`  🔴 НОВОЕ: ${f.mhz} МГц несёт «${f.tag}», а свидетель говорит «${f.witness}»`);
  }
  for (const m of r.stale) console.log(`  🔴 БАЗА ВРЁТ: ${m} МГц уже согласна — снимите её из ${relative(ROOT, BASELINE)}`);
  for (const m of r.missing) console.log(`  🔴 БАЗА ВРЁТ: ${m} МГц в базе, а судимой строки с такой частотой нет`);
  if (r.debt.length && argv.includes('--report')) {
    console.log(`  🟡 долг (перепрожиг по решению владельца, bugs/115 AC4 вариант Б): `
      + r.debt.map((d) => d.mhz).join(' · '));
  }
  return verdict(r);
}

function selftest() {
  let pass = 0; let fail = 0;
  const ok = (n, c, e = '') => { if (c) { pass += 1; console.log(`  ✅ ${n}`); } else { fail += 1; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };
  const row = (mhz, tag, w) => ({ mhz, tags: [tag], provenBy: w });
  const CAP = 'остановлено НАШИМ потолком глубины 150 мВ (рычаг достаёт до −340 мВ)';
  const LEV = 'глубже рычаг не достаёт';

  ok('согласная строка расхождением не считается',
    disagreements({ frequencies: [row(3000, 'stop:depth-capped', CAP)] }).rows.length === 0);
  ok('метка «предел сдвига» при свидетеле «наш потолок» — РАСХОЖДЕНИЕ',
    disagreements({ frequencies: [row(3000, 'stop:lever-limited', CAP)] }).rows.length === 1);
  ok('метка «потолок» при свидетеле «рычаг кончился» — тоже расхождение (обе стороны судятся)',
    disagreements({ frequencies: [row(3000, 'stop:depth-capped', LEV)] }).rows.length === 1);
  // 🔴 РАЗБОРЧИВЫЙ БЛОК: сторож, угадывающий смысл невнятного свидетеля, был бы третьим мнением.
  ok('свидетель, не говорящий ПРЯМО, не судится вовсе — и в число судимых не идёт', (() => {
    const d = disagreements({ frequencies: [row(3000, 'stop:lever-limited', 'что-то своё')] });
    return d.rows.length === 0 && d.judged === 0;
  })());
  const doc = { frequencies: [row(3000, 'stop:lever-limited', CAP), row(2900, 'stop:lever-limited', CAP)] };
  ok('расхождение В БАЗЕ — долг, сборку не валит',
    verdict(judge({ doc, baseline: { frequencies: [3000, 2900] } })) === 0);
  ok('расхождение ВНЕ базы — валит сборку',
    verdict(judge({ doc, baseline: { frequencies: [3000] } })) === 1);
  ok('база, назвавшая согласную строку, ВРЁТ и валит сборку — долг обязан убывать честно',
    verdict(judge({
      doc: { frequencies: [row(3000, 'stop:depth-capped', CAP)] },
      baseline: { frequencies: [3000] },
    })) === 1);

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node tools/witness-status-lint.mjs [--report] [--freeze] [--selftest]\n'
      + '  без флагов — судить боевой документ кривой против базы долга\n'
      + '  --report   — вдобавок перечислить частоты, стоящие в долге\n'
      + '  --freeze   — заморозить текущие расхождения как базу долга (осознанное действие)\n'
      + '  --selftest — батарея сторожа на фикстурах; боевой документ НЕ читается');
    process.exit(0);
  }
  process.exit(argv.includes('--selftest') ? selftest() : run(argv));
}
