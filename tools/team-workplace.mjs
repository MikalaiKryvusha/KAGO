#!/usr/bin/env node
// tools/team-workplace.mjs — РАБОЧИЕ МЕСТА КОМАНДЫ: git worktree под инвариантом имён.
//
// Контракт — TEAM_CONSTITUTION.md §1 (инвариант «адрес сессии = имя каталога = имя ветки =
// KAGO-team-<роль>») и §9 (свежий main ДО ритуала входа — обязанность менеджера; команда
// reset-from-main и есть исполнение этой обязанности одной строкой).
//
// Места — СОСЕДИ главной копии (d:\work\ai_sandbox\KAGO-team-<роль>): владелец различает окна
// по имени каталога, инфикс -team- виден с одного взгляда.
//
// GPU WRITES: none. Пишет только git-структуры (worktree, ветки) рядом с репозиторием.
//
// Usage:
//   npm run workplace -- create <роль>            # завести место (ветка от текущего main)
//   npm run workplace -- list                     # какие места существуют
//   npm run workplace -- reset-from-main <роль>   # менеджер, перед инструктажем: место = свежий main
//   npm run workplace -- remove <роль> [--force]  # убрать место (ветка остаётся)
//   npm run workplace -- --selftest
//
// [TESTED: 2026-08-28 · npm run workplace -- --selftest зелёный; create/list прогнаны живьём при
//  развёртывании команды — оба места встали и видны в git worktree list]

import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

const PROJECT = 'KAGO';
const TEAM_ROLES = ['engineer', 'verifier']; // менеджер places не имеет — его место ГЛАВНАЯ копия

/** Настоящий исполнитель git. Самопроверка подменяет его записывающим подставным (шов). */
function gitRun(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Имена места из роли — единственная точка, где инвариант имён превращается в пути. */
export function placeOf(mainRoot, role) {
  const name = `${PROJECT}-team-${role}`;
  return { name, branch: name, dir: join(dirname(mainRoot), name) };
}

export function assertRole(role) {
  if (!TEAM_ROLES.includes(role)) {
    throw new Error(`роль «${role}» не из состава команды (${TEAM_ROLES.join(' · ')}); место менеджера — сама главная копия`);
  }
}

/** create: ветка от main + worktree. Существующая ветка переиспользуется, а не пересоздаётся. */
export function createPlace(mainRoot, role, run = gitRun) {
  assertRole(role);
  const p = placeOf(mainRoot, role);
  if (existsSync(p.dir)) throw new Error(`каталог уже существует: ${p.dir} — место уже развёрнуто?`);
  const branches = run(['branch', '--list', p.branch], mainRoot).trim();
  if (branches) run(['worktree', 'add', p.dir, p.branch], mainRoot);
  else run(['worktree', 'add', '-b', p.branch, p.dir, 'main'], mainRoot);
  return p;
}

/** reset-from-main: место = свежий main. ГРЯЗНОЕ место не сбрасывается — сначала разберись. */
export function resetPlace(mainRoot, role, { force = false } = {}, run = gitRun) {
  assertRole(role);
  const p = placeOf(mainRoot, role);
  const dirty = run(['status', '--porcelain'], p.dir).trim();
  if (dirty && !force) {
    throw new Error(`место «${p.name}» ГРЯЗНОЕ (незакоммиченные правки):\n${dirty}\nсбрось руками или повтори с --force, если правки сознательно выбрасываются`);
  }
  run(['reset', '--hard', 'main'], p.dir);
  return p;
}

/** remove: worktree убирается, ветка ОСТАЁТСЯ (история дешёвая, потеря — дорогая). */
export function removePlace(mainRoot, role, { force = false } = {}, run = gitRun) {
  assertRole(role);
  const p = placeOf(mainRoot, role);
  const args = ['worktree', 'remove', p.dir];
  if (force) args.push('--force');
  run(args, mainRoot);
  return p;
}

function resolveMainRoot(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return dirname(resolve(cwd, common));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const mainRoot = resolveMainRoot(process.cwd());
  const [cmd, role] = argv;
  const force = argv.includes('--force');
  try {
    if (cmd === 'list' || cmd === undefined) {
      process.stdout.write(gitRun(['worktree', 'list'], mainRoot));
      return;
    }
    if (cmd === 'create') { const p = createPlace(mainRoot, role); console.log(`место развёрнуто: ${p.dir} (ветка ${p.branch})`); return; }
    if (cmd === 'reset-from-main') { const p = resetPlace(mainRoot, role, { force }); console.log(`место «${p.name}» = свежий main`); return; }
    if (cmd === 'remove') { const p = removePlace(mainRoot, role, { force }); console.log(`место убрано: ${p.dir} (ветка ${p.branch} оставлена)`); return; }
    console.error(`неизвестная команда: ${cmd}. Умею: create · list · reset-from-main · remove · --selftest`);
    process.exit(1);
  } catch (e) { console.error(`ОТКАЗ: ${e.message}`); process.exit(1); }
}

// ─── Самопроверка: git подменён записывающим подставным, диск не трогается ───────────────────────

function selftest() {
  let ok = 0, bad = 0;
  const t = (name, fn) => {
    try { fn(); ok++; console.log(`OK — ${name}`); }
    catch (e) { bad++; console.log(`ПЛОХО — ${name}: ${e.message}`); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const mainRoot = 'D:\\fake\\KAGO';

  t('инвариант имён: адрес = каталог = ветка, место — сосед главной копии', () => {
    const p = placeOf(mainRoot, 'engineer');
    assert(p.name === 'KAGO-team-engineer' && p.branch === p.name, 'имя/ветка разошлись');
    assert(p.dir === 'D:\\fake\\KAGO-team-engineer', `каталог не сосед: ${p.dir}`);
  });

  t('чужая роль и менеджер отвергаются: место менеджера — главная копия, не worktree', () => {
    let threw = 0;
    for (const r of ['manager', 'czar']) { try { assertRole(r); } catch { threw++; } }
    assert(threw === 2, 'лишняя роль прошла');
  });

  t('create: новой роли — ветка от main; существующей ветке — worktree без пересоздания', () => {
    const calls = [];
    const fake = (args) => { calls.push(args.join(' ')); return args[0] === 'branch' ? '' : ''; };
    createPlace(mainRoot, 'engineer', fake);
    assert(calls.some((c) => c === `worktree add -b KAGO-team-engineer D:\\fake\\KAGO-team-engineer main`), `ветки от main нет: ${calls}`);
    const calls2 = [];
    const fake2 = (args) => { calls2.push(args.join(' ')); return args[0] === 'branch' ? '  KAGO-team-engineer\n' : ''; };
    createPlace(mainRoot, 'engineer', fake2);
    assert(calls2.some((c) => c === `worktree add D:\\fake\\KAGO-team-engineer KAGO-team-engineer`), `существующая ветка пересоздана: ${calls2}`);
  });

  t('reset-from-main: ГРЯЗНОЕ место отказывает без --force и сбрасывается с ним', () => {
    const dirtyRun = (args) => (args[0] === 'status' ? ' M file.mjs\n' : '');
    let threw = false;
    try { resetPlace(mainRoot, 'engineer', {}, dirtyRun); } catch { threw = true; }
    assert(threw, 'грязное место сброшено молча');
    const calls = [];
    resetPlace(mainRoot, 'engineer', { force: true }, (args) => { calls.push(args.join(' ')); return args[0] === 'status' ? ' M f\n' : ''; });
    assert(calls.includes('reset --hard main'), 'reset --hard main не позван');
  });

  t('remove: ветка не удаляется — только worktree', () => {
    const calls = [];
    removePlace(mainRoot, 'verifier', {}, (args) => { calls.push(args.join(' ')); return ''; });
    assert(calls.some((c) => c.startsWith('worktree remove')), 'worktree remove не позван');
    assert(!calls.some((c) => c.startsWith('branch -')), 'ветка удалена, а обещали оставить');
  });

  console.log(`САМОПРОВЕРКА РАБОЧИХ МЕСТ: блоков ${ok + bad}, зелёных ${ok}, провалов ${bad}. git подставной, диск и карта не тронуты.`);
  process.exit(bad ? 1 : 0);
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) main();
