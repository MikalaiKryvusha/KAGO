#!/usr/bin/env node
// tools/team-board.mjs — ДОСКА СТАТУСОВ КОМАНДЫ: одна на команду, своя строка — своими руками.
//
// Контракт — в самом TEAM_STATUS.md (раздел «Board tool — the contract»), правила — в
// TEAM_CONSTITUTION.md §4. Шесть удержанных инвариантов:
//   1. Доска ОДНА и живёт в главной копии: путь решается через `git rev-parse --git-common-dir`,
//      а не через локальный checkout — иначе у каждой роли будет своя доска, которую никто не читает
//      (оплаченный полевой урок навыка /team-deployment).
//   2. Роль ВЫВОДИТСЯ из рабочего каталога (инвариант имён `KAGO-team-<роль>`; главная копия —
//      менеджер), а не передаётся заявлением. Чужая строка — отказ; сброс чужой строки — только
//      менеджер и только явным `--role`.
//   3. Конкурентные записи безопасны: замок-файл рядом с доской (create-exclusive + повторы,
//      замок старше 15 с считается брошенным), запись атомарна (tmp + rename).
//   4. Строка замка называет ДЕРЖАТЕЛЯ-роль. `gpu-card` отказывает всем, кроме менеджера
//      (конституция §0: карту трогает только менеджер, и только при владельце).
//   5. Штамп `YYYY-MM-DD HH:MM` берётся из системных часов инструментом — сессия его не помнит.
//   6. Доказано на сломанном случае ДО доверия — `--selftest` ниже, песочница mkdtemp.
//
// GPU WRITES: none. Пишет только TEAM_STATUS.md (и свой замок-файл рядом).
//
// Usage:
//   npm run team -- show
//   npm run team -- set [--busy|--free] [--doing "…"] [--waiting "…"]
//   npm run team -- set --role <r> --free          # только менеджер: очистить брошенную строку
//   npm run team -- lock <ресурс> | unlock <ресурс>
//   npm run team -- --selftest
//
// [TESTED: 2026-08-28 · npm run team -- --selftest — все блоки зелёные; живой отказ чужой строки
//  прогнан из worktree инженера при развёртывании]

import { readFileSync, writeFileSync, renameSync, existsSync, mkdtempSync, rmSync, openSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

const BOARD_NAME = 'TEAM_STATUS.md';
const PROJECT = 'KAGO';
const KNOWN_ROLES = ['manager', 'engineer', 'verifier'];
const MANAGER_ONLY_LOCKS = ['gpu-card']; // конституция §0
const LOCK_STALE_MS = 15_000;
const LOCK_RETRIES = 30;
const LOCK_RETRY_MS = 100;

// ─── Роль и путь к доске ─────────────────────────────────────────────────────────────────────────

/** Роль из ИМЕНИ каталога — инвариант конституции §1. Главная копия проекта = менеджер. */
export function deriveRole(dirName) {
  if (dirName === PROJECT) return 'manager';
  const m = dirName.match(new RegExp(`^${PROJECT}-team-([a-z-]+)$`));
  if (m && KNOWN_ROLES.includes(m[1])) return m[1];
  return null;
}

/** Главная копия через общий git-каталог: в worktree `--git-common-dir` указывает на .git ГЛАВНОЙ. */
function resolveMainRoot(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return dirname(resolve(cwd, common));
}

function stampNow(clock = () => new Date()) {
  const d = clock();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── Замок и атомарная запись ────────────────────────────────────────────────────────────────────

async function withFileLock(boardPath, fn) {
  const lockPath = boardPath + '.lock';
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try { return await fn(); }
      finally { closeSync(fd); unlinkSync(lockPath); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Брошенный замок: держатель умер, не прибрав за собой. Старше порога — снимаем и повторяем.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); continue; }
      } catch { continue; } // замок исчез между проверками — просто повторить
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  throw new Error(`доска занята: замок ${lockPath} не освободился за ${(LOCK_RETRIES * LOCK_RETRY_MS) / 1000} с`);
}

function writeAtomic(path, text) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

// ─── Правки строк (чистые функции — их гоняет самопроверка) ──────────────────────────────────────

/** Переписать строку роли в таблице Board. Возвращает новый текст; чужую строку не создаёт. */
export function rewriteRoleRow(text, role, { state, doing, waiting }, stamp) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`| ${role} |`));
  if (idx === -1) throw new Error(`строки роли «${role}» на доске нет`);
  const cells = lines[idx].split('|').map((s) => s.trim());
  // cells: ['', role, state, doing, waiting, updated, '']
  const next = {
    state: state ?? cells[2],
    doing: doing ?? cells[3],
    waiting: waiting ?? cells[4],
  };
  lines[idx] = `| ${role} | ${next.state} | ${next.doing} | ${next.waiting} | ${stamp} |`;
  return lines.join('\n');
}

/** Переписать строку ресурса в таблице Resource locks. */
export function rewriteLockRow(text, resource, holder, stamp) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`| ${resource} |`));
  if (idx === -1) throw new Error(`ресурса «${resource}» на доске нет`);
  lines[idx] = holder
    ? `| ${resource} | ${PROJECT}-team-${holder} | ${stamp} |`
    : `| ${resource} | — free — | — |`;
  return lines.join('\n');
}

export function lockHolder(text, resource) {
  const line = text.split('\n').find((l) => l.startsWith(`| ${resource} |`));
  if (!line) throw new Error(`ресурса «${resource}» на доске нет`);
  const holder = line.split('|').map((s) => s.trim())[2];
  return holder === '— free —' ? null : holder;
}

// ─── Команды ─────────────────────────────────────────────────────────────────────────────────────

function parseSetArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--busy') out.state = '🔴 busy';
    else if (a === '--free') { out.state = '🟢 free'; out.doing ??= '—'; out.waiting ??= '—'; }
    else if (a === '--doing') out.doing = argv[++i];
    else if (a === '--waiting') out.waiting = argv[++i];
    else if (a === '--role') out.role = argv[++i];
    else throw new Error(`неизвестный аргумент: ${a}`);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  const cwd = process.cwd();
  const myRole = deriveRole(basename(cwd));
  if (!myRole) {
    console.error(`ОТКАЗ: каталог «${basename(cwd)}» — не место команды ${PROJECT} (жду «${PROJECT}» или «${PROJECT}-team-<роль>»)`);
    process.exit(1);
  }
  const boardPath = join(resolveMainRoot(cwd), BOARD_NAME);
  if (!existsSync(boardPath)) { console.error(`ОТКАЗ: доска не найдена — ${boardPath}`); process.exit(1); }

  const cmd = argv[0];
  if (cmd === 'show' || cmd === undefined) {
    console.log(readFileSync(boardPath, 'utf8'));
    return;
  }
  if (cmd === 'set') {
    const opts = parseSetArgs(argv.slice(1));
    let target = myRole;
    if (opts.role && opts.role !== myRole) {
      // Сброс ЧУЖОЙ строки — только менеджер, и только явным флагом (инвариант 2).
      if (myRole !== 'manager') { console.error(`ОТКАЗ: роль «${myRole}» не правит чужую строку «${opts.role}» — это может только менеджер`); process.exit(1); }
      target = opts.role;
    }
    await withFileLock(boardPath, () => {
      writeAtomic(boardPath, rewriteRoleRow(readFileSync(boardPath, 'utf8'), target, opts, stampNow()));
    });
    console.log(`доска: строка «${target}» переписана (${opts.state ?? 'состояние прежнее'})`);
    return;
  }
  if (cmd === 'lock' || cmd === 'unlock') {
    const resource = argv[1];
    if (!resource) { console.error(`ОТКАЗ: назови ресурс — npm run team -- ${cmd} <ресурс>`); process.exit(1); }
    if (cmd === 'lock' && MANAGER_ONLY_LOCKS.includes(resource) && myRole !== 'manager') {
      console.error(`ОТКАЗ: «${resource}» берёт только менеджер (конституция §0 — карту трогает одно место, при владельце)`);
      process.exit(1);
    }
    // ВАЖНО: внутри withFileLock НЕ выходить через process.exit — он не даст исполниться finally,
    // и замок-файл останется брошенным. Колбэк ВОЗВРАЩАЕТ исход, выходим уже снаружи.
    const outcome = await withFileLock(boardPath, () => {
      const text = readFileSync(boardPath, 'utf8');
      const holder = lockHolder(text, resource);
      if (cmd === 'lock') {
        if (holder) return { code: 1, msg: `ОТКАЗ: «${resource}» уже держит ${holder} — договаривайся сообщением` };
        writeAtomic(boardPath, rewriteLockRow(text, resource, myRole, stampNow()));
        return { code: 0, msg: `замок «${resource}» взят: ${PROJECT}-team-${myRole}` };
      }
      if (!holder) return { code: 0, msg: `«${resource}» и так свободен` };
      if (holder !== `${PROJECT}-team-${myRole}` && myRole !== 'manager') {
        return { code: 1, msg: `ОТКАЗ: «${resource}» держит ${holder}, а ты ${PROJECT}-team-${myRole} — снять может держатель или менеджер` };
      }
      writeAtomic(boardPath, rewriteLockRow(text, resource, null, null));
      return { code: 0, msg: `замок «${resource}» снят` };
    });
    (outcome.code ? console.error : console.log)(outcome.msg);
    process.exit(outcome.code);
  }
  console.error(`неизвестная команда: ${cmd}. Умею: show · set · lock · unlock · --selftest`);
  process.exit(1);
}

// ─── Самопроверка: песочница, ноль GPU, ноль настоящей доски ─────────────────────────────────────

const FIXTURE = `# TEAM_STATUS — sandbox

## Board

| Role | State | Doing | Waiting for | Updated |
|---|---|---|---|---|
| manager | 🟢 free | — | — | 2026-01-01 00:00 |
| engineer | 🟢 free | — | — | 2026-01-01 00:00 |
| verifier | 🟢 free | — | — | 2026-01-01 00:00 |

## Resource locks

| Resource | Holder | Taken |
|---|---|---|
| gpu-card | — free — | — |
| dashboard-port | — free — | — |
`;

async function selftest() {
  let ok = 0, bad = 0;
  const t = (name, fn) => {
    try { fn(); ok++; console.log(`OK — ${name}`); }
    catch (e) { bad++; console.log(`ПЛОХО — ${name}: ${e.message}`); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const sandbox = mkdtempSync(join(tmpdir(), 'kago-team-board-'));
  try {
    const stamp = '2026-08-28 14:30';

    t('роль из каталога: главная копия — менеджер, worktree — своя роль, чужой каталог — никто', () => {
      assert(deriveRole('KAGO') === 'manager', 'KAGO не стал менеджером');
      assert(deriveRole('KAGO-team-engineer') === 'engineer', 'worktree инженера не распознан');
      assert(deriveRole('KAGO-team-verifier') === 'verifier', 'worktree контролёра не распознан');
      assert(deriveRole('OTHER-team-engineer') === null, 'чужой проект прошёл за свой');
      assert(deriveRole('KAGO-team-czar') === null, 'неизвестная роль прошла за известную');
    });

    t('своя строка переписывается, остальные не тронуты, штамп со всей строкой на месте', () => {
      const next = rewriteRoleRow(FIXTURE, 'engineer', { state: '🔴 busy', doing: 'спасатель', waiting: '—' }, stamp);
      assert(next.includes(`| engineer | 🔴 busy | спасатель | — | ${stamp} |`), 'строка инженера не переписана');
      assert(next.includes('| manager | 🟢 free | — | — | 2026-01-01 00:00 |'), 'строка менеджера пострадала');
      assert(next.includes('| verifier | 🟢 free | — | — | 2026-01-01 00:00 |'), 'строка контролёра пострадала');
    });

    t('доска не растёт: повторные правки не добавляют строк', () => {
      let text = FIXTURE;
      for (let i = 0; i < 5; i++) text = rewriteRoleRow(text, 'engineer', { doing: `итерация ${i}` }, stamp);
      assert(text.split('\n').length === FIXTURE.split('\n').length, 'документ вырос');
    });

    t('строки несуществующей роли нет — отказ, а не тихое создание', () => {
      let threw = false;
      try { rewriteRoleRow(FIXTURE, 'czar', { state: 'x' }, stamp); } catch { threw = true; }
      assert(threw, 'несуществующая роль прошла без отказа');
    });

    t('замок ресурса: взятие называет держателя адресом, снятие возвращает «— free —»', () => {
      const taken = rewriteLockRow(FIXTURE, 'dashboard-port', 'verifier', stamp);
      assert(taken.includes(`| dashboard-port | KAGO-team-verifier | ${stamp} |`), 'держатель не назван адресом');
      assert(lockHolder(taken, 'dashboard-port') === 'KAGO-team-verifier', 'держатель не читается');
      const freed = rewriteLockRow(taken, 'dashboard-port', null, null);
      assert(lockHolder(freed, 'dashboard-port') === null, 'ресурс не освободился');
    });

    t('gpu-card — в списке «только менеджер» (сам отказ исполняет main, здесь сторожим список)', () => {
      assert(MANAGER_ONLY_LOCKS.includes('gpu-card'), 'gpu-card выпал из менеджерского списка');
    });

    // Асинхронный блок — честным await, счётчики те же.
    await (async () => {
      const name = 'конкуренция: занятый замок держит, брошенный — снимается, запись атомарна';
      try {
        const board = join(sandbox, BOARD_NAME);
        writeFileSync(board, FIXTURE, 'utf8');
        // 1) живой замок: create-exclusive отказал бы второму — берём файл сами и убеждаемся, что
        //    withFileLock честно ждёт (короткая гонка: снимаем замок через 300 мс, работа проходит).
        const fd = openSync(board + '.lock', 'wx');
        setTimeout(() => { closeSync(fd); unlinkSync(board + '.lock'); }, 300);
        await withFileLock(board, () => {
          writeAtomic(board, rewriteRoleRow(readFileSync(board, 'utf8'), 'manager', { doing: 'после ожидания' }, stamp));
        });
        assert(readFileSync(board, 'utf8').includes('после ожидания'), 'запись после ожидания замка не прошла');
        // 2) брошенный замок: файл есть, но mtime старше порога — должен быть снят без ожидания вечности.
        writeFileSync(board + '.lock', 'dead', 'utf8');
        const past = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
        const { utimesSync } = await import('node:fs');
        utimesSync(board + '.lock', past, past);
        await withFileLock(board, () => {});
        assert(!existsSync(board + '.lock'), 'брошенный замок пережил проход');
        ok++; console.log(`OK — ${name}`);
      } catch (e) { bad++; console.log(`ПЛОХО — ${name}: ${e.message}`); }
    })();

  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  console.log(`САМОПРОВЕРКА ДОСКИ КОМАНДЫ: блоков ${ok + bad}, зелёных ${ok}, провалов ${bad}. Песочница прибрана, настоящая доска и карта не тронуты.`);
  process.exit(bad ? 1 : 0);
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) main().catch((e) => { console.error(`ОШИБКА: ${e.message}`); process.exit(1); });
