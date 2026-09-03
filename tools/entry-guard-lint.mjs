#!/usr/bin/env node
/**
 * ЛИНТЕР КЛАССА `bugs/95`: КАЖДЫЙ ПРИБОР `tools/*.mjs` ОБЯЗАН НЕСТИ СТОРОЖ ВХОДА.
 *
 * THREAT:         импорт прибора ИСПОЛНЯЕТ его работу — в языке, где модуль исполняется при
 *                 загрузке, «просто посмотреть, что экспортируется» есть запуск чужого CLI с
 *                 argv вызывающего. Оплачено: `tidy.mjs` при импорте снимал сэмплеры и окна
 *                 владельца; `grant-agent-*.mjs` писали его файл прав; цикл импорта ради описи
 *                 пересобрал три бинарника прожига (EXP-0218); поправочные приборы писали в боевой
 *                 журнал развёртки. Класс за две недели вырос с 8 до 16 приборов — текстовое правило
 *                 не держит.
 * PROVED-AGAINST: (а) фикстура без сторожа вне базы → КРАСНО; (б) фикстура без сторожа В базе →
 *                 долг, не красно; (в) фикстура СО сторожем, оставшаяся в базе → КРАСНО «снять из
 *                 базы» (база только убывает); (г) имя в базе без файла → КРАСНО; (д) ворота
 *                 `check.mjs` краснеют на настоящем незащищённом файле в `tools/` (прогнано 04.09
 *                 на временном файле, снят после).
 * GAP:            признак сторожа — ТЕКСТОВЫЙ (строка с `process.argv[1]` И `import.meta.url` в
 *                 одном файле), а не разбор синтаксиса: файл, где сравнение написано, но стоит не
 *                 вокруг работы, пройдёт зелёным. Второй зазор — линтер судит только `tools/`;
 *                 `automation-engine/lib/*.mjs` с `--selftest` имеют свои сторожа и сюда не входят.
 * ON-REAL-PATH:   2026-09-04 — в воротах `npm run check` (шестые ворота), запущен на настоящем
 *                 дереве: 33 прибора, база долга заморожена и убывает по мере починки.
 *
 * Форма — по образцу `guard-lint.mjs` + `decisions/*-baseline.json`: замороженный долг это
 * РЕШЕНИЕ, а не артефакт прогона; новые нарушения валят сборку, старые — не валят, но и не
 * растут; починенный прибор ОБЯЗАН быть снят из базы, иначе база врёт (пара «правда ↔ зеркало»).
 *
 *   node tools/entry-guard-lint.mjs             # судить дерево (код 1 на новом нарушении)
 *   node tools/entry-guard-lint.mjs --freeze    # заморозить ТЕКУЩИЙ долг в базу (первый раз)
 *   node tools/entry-guard-lint.mjs --selftest  # доказать сторож на фикстурах в песочнице
 *
 * [TESTED: 2026-09-04 · --selftest 7 блоков на mkdtemp-фикстурах; мутация «признак сторожа
 *  всегда истинен» красит блоки (а)(б)(в) и ни одного другого; живой прогон по tools/: 16 красных
 *  до починки, 0 после; ворота `npm run check` покраснели на временном голом файле `_zz_naked.mjs`]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'tools');
const BASELINE = join(ROOT, 'decisions', 'entry-guard-baseline.json');

/** Признак сторожа входа: обе половины сравнения в одном файле. Чистая функция над текстом. */
export function hasEntryGuard(src) {
  return src.includes('process.argv[1]') && src.includes('import.meta.url');
}

/** Все приборы каталога — только `.mjs`, без временных копий голденов (`_g_*`). */
export function listTools(dir = TOOLS) {
  return readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_g_')).sort();
}

export function readBaseline(path = BASELINE) {
  if (!existsSync(path)) return { frozenAt: null, files: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { frozenAt: null, files: [] }; }
}

export function writeBaseline(files, { path = BASELINE, at = new Date().toISOString() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ frozenAt: at, files: [...files].sort() }, null, 2)}\n`, 'utf8');
}

/**
 * Суд над каталогом. Возвращает четыре списка — и ни один не выводится из другого:
 *   fresh   — без сторожа и НЕ в базе → валит сборку;
 *   debt    — без сторожа и в базе → терпится, но должен убывать;
 *   stale   — в базе, но сторож уже есть → валит сборку: базу обязаны подрезать;
 *   missing — в базе, но файла нет → валит сборку: база называет несуществующее.
 */
export function judge({ dir = TOOLS, baseline = readBaseline() } = {}) {
  const files = listTools(dir);
  const base = new Set(baseline.files ?? []);
  const fresh = []; const debt = []; const stale = [];
  for (const f of files) {
    const guarded = hasEntryGuard(readFileSync(join(dir, f), 'utf8'));
    if (guarded && base.has(f)) stale.push(f);
    else if (!guarded) (base.has(f) ? debt : fresh).push(f);
  }
  const missing = [...base].filter((f) => !files.includes(f));
  return { files, fresh, debt, stale, missing };
}

function report(r, baselinePath) {
  const lines = [];
  lines.push(`СТОРОЖ ВХОДА (bugs/95): приборов ${r.files.length} · без сторожа ${r.fresh.length + r.debt.length} · в долге ${r.debt.length}`);
  for (const f of r.fresh) lines.push(`  🔴 НОВОЕ: tools/${f} — исполняется при импорте; форма починки: main(argv) + сторож входа (образец: tools/check.mjs)`);
  for (const f of r.stale) lines.push(`  🔴 БАЗА ВРЁТ: tools/${f} уже под сторожем — снимите его из ${relative(ROOT, baselinePath)}`);
  for (const f of r.missing) lines.push(`  🔴 БАЗА ВРЁТ: tools/${f} в базе, а файла нет — снимите его из ${relative(ROOT, baselinePath)}`);
  for (const f of r.debt) lines.push(`  🟡 долг: tools/${f}`);
  return lines.join('\n');
}

/** Код выхода: красно на новом нарушении и на лгущей базе; долг не краснит. */
export function verdict(r) {
  return r.fresh.length === 0 && r.stale.length === 0 && r.missing.length === 0 ? 0 : 1;
}

/**
 * Самопроверка на фикстурах в песочнице `mkdtemp` — настоящий `tools/` не читается вовсе.
 * Каждый блок судит ОДИН список результата, чтобы мутация красила ровно свой блок.
 */
function selfTest() {
  const GUARDED = "import { resolve } from 'node:path';\nfunction main() {}\nif (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();\n";
  const NAKED = "console.log('work on import');\n";
  const blocks = [];
  const check = (name, ok, detail = '') => blocks.push({ name, ok, detail });
  const dir = mkdtempSync(join(tmpdir(), 'kago-entry-guard-'));
  try {
    writeFileSync(join(dir, 'a-guarded.mjs'), GUARDED);
    writeFileSync(join(dir, 'b-naked.mjs'), NAKED);
    writeFileSync(join(dir, 'c-debt.mjs'), NAKED);
    writeFileSync(join(dir, 'd-fixed.mjs'), GUARDED);
    writeFileSync(join(dir, '_g_copy.mjs'), NAKED);          // копия голдена — не прибор
    const baseline = { frozenAt: 'x', files: ['c-debt.mjs', 'd-fixed.mjs', 'e-gone.mjs'] };
    const r = judge({ dir, baseline });

    check('(а) без сторожа и вне базы → НОВОЕ нарушение', r.fresh.length === 1 && r.fresh[0] === 'b-naked.mjs', JSON.stringify(r.fresh));
    check('(б) без сторожа и в базе → долг, не нарушение', r.debt.length === 1 && r.debt[0] === 'c-debt.mjs', JSON.stringify(r.debt));
    check('(в) под сторожем, но в базе → база врёт', r.stale.length === 1 && r.stale[0] === 'd-fixed.mjs', JSON.stringify(r.stale));
    check('(г) в базе без файла → база врёт', r.missing.length === 1 && r.missing[0] === 'e-gone.mjs', JSON.stringify(r.missing));
    check('под сторожем и не в базе → молчит', !r.fresh.includes('a-guarded.mjs') && !r.debt.includes('a-guarded.mjs'));
    check('копия голдена `_g_*` — не прибор', !r.files.includes('_g_copy.mjs'), JSON.stringify(r.files));
    check('вердикт: любое из (а)(в)(г) → код 1; один долг → код 0',
      verdict(r) === 1 && verdict({ fresh: [], stale: [], missing: [], debt: ['x'] }) === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const b of blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
  const failed = blocks.filter((b) => !b.ok).length;
  console.log(`\nСАМОПРОВЕРКА СТОРОЖА ВХОДА: ${blocks.length} блоков, провалов ${failed}. Настоящий tools/ не читался.`);
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--selftest')) return selfTest();
  if (argv.includes('--freeze')) {
    const r = judge({ baseline: { files: [] } });
    writeBaseline(r.fresh);
    console.log(`ДОЛГ ЗАМОРОЖЕН: ${r.fresh.length} прибор(ов) → ${relative(ROOT, BASELINE)}. Он может только убывать.`);
    return 0;
  }
  const r = judge();
  console.log(report(r, BASELINE));
  return verdict(r);
}

// СТОРОЖ ВХОДА — линтер сам исполняется только как программа (иначе он был бы первым нарушителем).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
