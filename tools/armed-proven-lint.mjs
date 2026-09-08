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

export function audit(text) {
  const flags = armedFlags(text);
  const proofs = proofBlocks(text);
  const problems = [];
  for (const f of flags) {
    const p = proofs.get(f);
    if (!p) problems.push({ flag: f, why: 'нет блока с меткой [ДОКАЗЫВАЕТ ' + f + '] — вход можно объявить взведённым, ни разу не показав его трип' });
    else if (!p.provesTrip) problems.push({ flag: f, why: `блок на строке ${p.line} помечен, но НЕ утверждает \`tripped === true\` — метка без доказательства` });
  }
  return { flags, proofs, problems };
}

function run() {
  const text = readFileSync(FUSE, 'utf8');
  const { flags, proofs, problems } = audit(text);
  console.log(`«ВЗВЕДЁН» ≠ «ДОКАЗАН» (bugs/117, plans/91 Ш6): входов ${flags.length} · доказаны трипом ${proofs.size}`);
  for (const f of flags) {
    const p = proofs.get(f);
    console.log(`  ${p?.provesTrip ? '✅' : '🔴'} ${f} → ${p ? `блок строки ${p.line}` : 'ДОКАЗАТЕЛЬСТВА НЕТ'}`);
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
  ok('вход с настоящим доказательством проходит', audit(good).problems.length === 0);
  ok('вход БЕЗ блока-доказательства краснеет', audit(noProof).problems.length === 1);
  ok('МЕТКА БЕЗ утверждения о трипе краснеет — метка не заменяет доказательства',
    audit(fakeProof).problems.length === 1 && /НЕ утверждает/u.test(audit(fakeProof).problems[0].why));
  ok('боевой файл: все входы судьи доказаны трипом', audit(readFileSync(FUSE, 'utf8')).problems.length === 0,
    JSON.stringify(audit(readFileSync(FUSE, 'utf8')).problems));
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
