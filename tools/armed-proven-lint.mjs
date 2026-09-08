// armed-proven-lint.mjs — «ВЗВЕДЁН» НЕ ЗНАЧИТ «ДОКАЗАН». Сторож, который поймал бы 2026-09-08.
//
// `plans/91` Ш6 (AC7). Родитель — `bugs/117`.
//
// 🔴 ЧТО СЛУЧИЛОСЬ И ЧЕГО ЭТОТ СТОРОЖ НЕ ДАЁТ ПОВТОРИТЬ. Утром 08.09 движок напечатал в журнал
// живого прогона «ВТОРОЙ ВХОД (прогресс прожига) ВЗВЕДЁН: M = 1177 мс». Строка была ПРАВДОЙ по
// аргументам: судья действительно получил `--arm-m 1177`. Агент прочитал её, пересказал владельцу
// как доказанную защиту и на этом основании пустил полосу без потолка глубины. Машина упала синим
// экраном, трипов ноль — потому что величина этого входа была обрезана его же порогом и трипать не
// могла НИКОГДА. «Взведён» и «умеет сработать» оказались разными утверждениями, и между ними не
// стояло ничего.
//
// ПРАВИЛО. У каждого взводимого входа предохранителя (`--arm-*` в разборе аргументов судьи) обязан
// быть блок батареи, ДОКАЗЫВАЮЩИЙ ТРИПОМ, что вход умеет сработать. Блок помечается меткой
// `[ДОКАЗЫВАЕТ --arm-X]` в заголовке и обязан утверждать `tripped === true`.
//
// ПОЧЕМУ МЕТКА, А НЕ УГАДЫВАНИЕ ПО ЗАГОЛОВКУ: заголовки блоков живут и переписываются, и сторож,
// ищущий их по смыслу, зеленел бы от переименования. Метка — договор, а не догадка.
//
// [TESTED: 2026-09-08 · три входа найдены, три метки найдены, красный доказан снятием метки]

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FUSE = join(ROOT, 'automation-engine', 'lib', 'fuse.mjs');

/** Флаги взведения, которые судья РАЗБИРАЕТ, — источник истины о том, сколько входов существует. */
export function armedFlags(text) {
  const out = new Set();
  for (const m of text.matchAll(/has\('(--arm-[a-z])'\)/gu)) out.add(m[1]);
  return [...out].sort();
}

/** Блоки батареи, объявившие себя доказательством входа: метка + утверждение о трипе рядом. */
export function proofBlocks(text) {
  const lines = text.split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /\[ДОКАЗЫВАЕТ (--arm-[a-z])\]/u.exec(lines[i]);
    if (!m) continue;
    // Утверждение живёт в следующих строках того же вызова `ok(` — шести хватает с запасом, и
    // граница названа, чтобы сторож не «нашёл» трип соседнего блока.
    const body = lines.slice(i, i + 6).join('\n');
    out.set(m[1], { line: i + 1, provesTrip: /tripped === true/u.test(body) });
  }
  return out;
}

/**
 * 🔴 ВТОРОЙ ВОПРОС СТОРОЖА, ОПЛАЧЕННЫЙ СМЕРТЬЮ МАШИНЫ 2026-09-08 17:53 (`bugs/127` Ш4, `plans/93` Ш7).
 *
 * Первый вопрос («есть ли блок, показывающий трип») сторож задавал с 08.09 и всё это время был
 * ЗЕЛЁН, пока вход 3 на живой карте не трипал ни разу. Причина названа `bugs/127`: оба блока
 * `[ДОКАЗЫВАЕТ --arm-p]` держат файл сердцебиения ЖИВЫМ, поэтому ворота ложного трипа в них не
 * срабатывают никогда. Вход доказан на данных, из которых убрана переменная, его разоружающая.
 * Агент прочитал строку `доказаны трипом 3` в зелёных воротах, понял её как «защита работает» и
 * пустил живую полосу. Машина умерла через 24 секунды.
 *
 * ДОГОВОР ВТОРОГО ВОПРОСА: у входа обязан быть блок с меткой `[ПОЛЕ --arm-X]`, и в нём обязан
 * стоять вызов `replayRing` — то есть блок судит ЗАПИСЬ ЧЁРНОГО ЯЩИКА целиком, со всеми
 * переменными, какие были в бою, а не ряд чисел, набранный руками.
 *
 * ⚠️ ПОЧЕМУ `replayRing`, А НЕ ИМЯ ФАЙЛА: имена фикстур живут и переименовываются, а проигрыватель
 * — единственная дверь к записи. Метка + вызов есть договор; поиск по смыслу был бы догадкой.
 */
export function fieldBlocks(text) {
  const lines = text.split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /\[ПОЛЕ (--arm-[a-z])\]/u.exec(lines[i]);
    if (!m) continue;
    const body = lines.slice(i, i + 8).join('\n');
    out.set(m[1], { line: i + 1, playsRecord: /replayRing\(/u.test(body) });
  }
  return out;
}

export function audit(text, { fieldDebt = new Set() } = {}) {
  const flags = armedFlags(text);
  const proofs = proofBlocks(text);
  const fields = fieldBlocks(text);
  const problems = [];
  for (const f of flags) {
    const p = proofs.get(f);
    if (!p) problems.push({ flag: f, why: 'нет блока с меткой [ДОКАЗЫВАЕТ ' + f + '] — вход можно объявить взведённым, ни разу не показав его трип' });
    else if (!p.provesTrip) problems.push({ flag: f, why: `блок на строке ${p.line} помечен, но НЕ утверждает \`tripped === true\` — метка без доказательства` });
    // Второй вопрос. Долг — это НАЗВАННОЕ отсутствие полевого доказательства, а не его замена.
    const g = fields.get(f);
    if (!g) {
      if (!fieldDebt.has(f)) {
        problems.push({ flag: f, why: 'нет блока с меткой [ПОЛЕ ' + f + '] — вход не судился ни одной записью чёрного ящика; фикстура из набранных чисел умеет забыть переменную, которая вход разоружает (bugs/127)' });
      }
    } else if (!g.playsRecord) {
      problems.push({ flag: f, why: `блок на строке ${g.line} помечен [ПОЛЕ], но не зовёт \`replayRing\` — метка без записи` });
    }
  }
  return { flags, proofs, fields, problems };
}

/** Долг второго вопроса: входы, у которых полевого доказательства ЕЩЁ НЕТ, названы поимённо. */
export const FIELD_BASELINE = join(ROOT, 'decisions', 'armed-proven-field-baseline.json');

function readFieldDebt() {
  try { return new Set(JSON.parse(readFileSync(FIELD_BASELINE, 'utf8')).keys); } catch { return new Set(); }
}

function run() {
  const text = readFileSync(FUSE, 'utf8');
  const debt = readFieldDebt();
  const { flags, proofs, fields, problems } = audit(text, { fieldDebt: debt });
  const played = [...fields.values()].filter((g) => g.playsRecord).length;
  // 🔴 СТРОКА ПЕРЕПИСАНА ПО `plans/93` AC5. Прежняя — «доказаны трипом 3» — читалась как «защита
  // годна к бою», и именно так её прочитал агент перед смертью машины 17:53. Теперь фикстуры и
  // поле названы РАЗНЫМИ числами, и долг поля виден в той же строке.
  console.log(`«ВЗВЕДЁН» ≠ «ДОКАЗАН» (bugs/117, plans/91 Ш6, plans/93 Ш7): входов ${flags.length}`
    + ` · трипают НА ФИКСТУРЕ ${proofs.size} · судились ЗАПИСЬЮ ПОЛЯ ${played} · в долге поля ${debt.size}`);
  for (const f of flags) {
    const p = proofs.get(f);
    const g = fields.get(f);
    const fieldMark = g?.playsRecord ? `поле: строка ${g.line}` : (debt.has(f) ? 'ПОЛЯ НЕТ (в долге)' : 'ПОЛЯ НЕТ');
    console.log(`  ${p?.provesTrip ? '✅' : '🔴'} ${f} → ${p ? `фикстура: строка ${p.line}` : 'ФИКСТУРЫ НЕТ'} · ${g?.playsRecord ? '✅' : '🟡'} ${fieldMark}`);
  }
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`  🔴 ${p.flag}: ${p.why}`);
    console.log('ИТОГ: КРАСНО. Вход, который нельзя объявить доказанным, нельзя объявлять и взведённым.');
    return 1;
  }
  console.log('ИТОГ: ЧИСТО.');
  return 0;
}

function selftest() {
  let pass = 0; let fail = 0;
  const ok = (n, c, e = '') => { if (c) { pass += 1; console.log(`  ✅ ${n}`); } else { fail += 1; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };
  const good = "has('--arm-q')\nok('блок [ДОКАЗЫВАЕТ --arm-q]',\n  r.tripped === true);";
  const noProof = "has('--arm-q')\nok('обычный блок', r.ok === true);";
  const fakeProof = "has('--arm-q')\nok('блок [ДОКАЗЫВАЕТ --arm-q]',\n  r.ok === true);";
  // Первый вопрос судится в отрыве от второго: долг поля закрыт для синтетического входа.
  const q1 = { fieldDebt: new Set(['--arm-q']) };
  ok('вход с настоящим доказательством проходит', audit(good, q1).problems.length === 0);
  ok('вход БЕЗ блока-доказательства краснеет', audit(noProof, q1).problems.length === 1);
  ok('МЕТКА БЕЗ утверждения о трипе краснеет — метка не заменяет доказательства',
    audit(fakeProof, q1).problems.length === 1 && /НЕ утверждает/u.test(audit(fakeProof, q1).problems[0].why));

  // ---- ВТОРОЙ ВОПРОС (`plans/93` Ш7) — тот, которого не хватало 08.09 -------------------------
  const noField = "has('--arm-q')\nok('блок [ДОКАЗЫВАЕТ --arm-q]',\n  r.tripped === true);";
  ok('🔴 вход БЕЗ полевого блока и БЕЗ долга краснеет — фикстуры мало, это урок смерти 17:53',
    audit(noField).problems.length === 1 && /\[ПОЛЕ/u.test(audit(noField).problems[0].why),
    JSON.stringify(audit(noField).problems));
  const fieldOk = `${noField}\n// [ПОЛЕ --arm-q]\nconst rep = replayRing(REC, LIVE);`;
  ok('вход с полевым блоком, зовущим replayRing, проходит', audit(fieldOk).problems.length === 0,
    JSON.stringify(audit(fieldOk).problems));
  const fieldFake = `${noField}\n// [ПОЛЕ --arm-q]\nok('судим по памяти', true);`;
  ok('МЕТКА [ПОЛЕ] БЕЗ вызова replayRing краснеет — метка не заменяет записи',
    audit(fieldFake).problems.length === 1 && /не зовёт/u.test(audit(fieldFake).problems[0].why),
    JSON.stringify(audit(fieldFake).problems));
  ok('долг ЗАКРЫВАЕТ красноту, но не подменяет доказательство: вход в долге проходит молча',
    audit(noField, { fieldDebt: new Set(['--arm-q']) }).problems.length === 0);

  const live = audit(readFileSync(FUSE, 'utf8'), { fieldDebt: readFieldDebt() });
  ok('боевой файл: оба вопроса закрыты — фикстура у всех, поле у всех кроме названных в долге',
    live.problems.length === 0, JSON.stringify(live.problems));
  // 🟢 ДОЛГ ВХОДА 3 ЗАКРЫТ 2026-09-08 19:2x — живым трипом, а не меткой. Прогон 19:21 дал 9
  // срабатываний защиты при живой машине, два из них по причине `power-collapse` — первые полевые
  // трипы входа 3 за всю историю проекта. Прежнее утверждение здесь («вход 3 честно в долге») было
  // верным ровно до этого прогона; оно переписано, а не удалено, чтобы условие осталось под сторожем.
  {
    const src = readFileSync(FUSE, 'utf8');
    const g = fieldBlocks(src).get('--arm-p');
    ok('боевой файл: вход 3 ВЫШЕЛ из долга поля и вышел ПРАВИЛЬНО — у него есть блок, зовущий запись',
      !readFieldDebt().has('--arm-p') && g !== undefined && g.playsRecord === true,
      `в долге: ${readFieldDebt().has('--arm-p')}, блок: ${g ? `строка ${g.line}, зовёт запись ${g.playsRecord}` : 'НЕТ'}`);
  }
  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node tools/armed-proven-lint.mjs [--selftest]\n'
      + '  без флагов — проверить, что каждый взводимый вход предохранителя доказан трипом в батарее\n'
      + '  --selftest — батарея сторожа');
    process.exit(0);
  }
  process.exit(argv.includes('--selftest') ? selftest() : run());
}
