// automation-engine/lib/remembered-state.mjs — THE REMEMBERED STATE AND THE BOOT JOURNAL: disk only,
// no GPU. Phase 3 step 4.4 (plans/06_epic01_phase3_shell.md §4.4).
//
// WHAT THE REMEMBERED STATE IS (internal map §4): every shortcut — reset included — ends in the
// applier writing the same small record: which profile was last VERIFIED applied. The logon task
// reads it and re-applies through the same applier gates; the tray (§4.5) displays it and owns
// nothing. It is ORCHESTRATOR state, not card telemetry — the truth↔mirror boundary the plan names.
//
// WHO WRITES IT: the applier's CLI layer (`--apply`, `--reset`) — NOT the library `apply()` —
// because measurement tools (engine, vfstep, descend) drive profiles through the library to take
// readings, and a measurement must never move the owner's boot state.
//
// WHY EVERY PATH IS PARAMETERIZED BY ITS FILE PATH: a selftest that writes into the production
// directory fabricates forensics a later session reads as history (EXP-0025). Every function takes
// the path; the production constants are defaults, and the suites pass a sandbox.
//
// [TESTED: 2026-08-14 · exercised by profile-manager's --selftest boot blocks (sandboxed tmpdir:
//  round-trip, corrupt file degrades to a named problem, journal appends rather than overwrites)
//  and live by the §4.4 proofs — the applier wrote the record on a real apply, the boot task read
//  it back.]

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Where the shell keeps its machine-local state. `runs/` is git-ignored on purpose: this is THIS
 *  machine's state, not project history. */
export const SHELL_RUNS_DIR = path.join(REPO_ROOT, 'runs', 'shell');
export const REMEMBERED_STATE_PATH = path.join(SHELL_RUNS_DIR, 'remembered-state.json');
export const BOOT_JOURNAL_PATH = path.join(SHELL_RUNS_DIR, 'boot-apply.jsonl');

/** Local ISO 8601 with the machine's offset — a record stamped in UTC already lied once (EXP-0012). */
export function localIso(d = new Date()) {
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

/**
 * Write the remembered state. Called only after a VERIFIED apply (read-back agreed) — the record's
 * meaning is «this is what the card was proven to hold», never «this is what somebody asked for».
 */
export function writeRememberedState({ profile, title = null, stamp = null }, filePath = REMEMBERED_STATE_PATH) {
  if (typeof profile !== 'string' || !profile) throw new Error('запомненное состояние без имени профиля — запись отвергнута');
  const record = {
    what: 'Последнее ВЕРИФИЦИРОВАННОЕ применение. Пишет только CLI применителя после сошедшегося перечитывания; логон-задача перечитывает и восстанавливает через те же ворота.',
    profile,
    title,
    stamp: stamp ? { driver: stamp.driver, vbios: stamp.vbios } : null,
    writtenAt: localIso(),
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Read the remembered state. Three honest answers, never a throw:
 *   { state, problem: null }        — a well-formed record
 *   { state: null, problem: null }  — no file: nothing was ever remembered (factory by physics)
 *   { state: null, problem: '…' }   — the file exists and cannot be trusted; the caller degrades
 *                                     LOUDLY to factory instead of guessing (three doors: a gap is
 *                                     never filled by invention)
 */
export function readRememberedState(filePath = REMEMBERED_STATE_PATH) {
  if (!existsSync(filePath)) return { state: null, problem: null };
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { state: null, problem: `файл состояния не читается: ${e.message}` };
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    return { state: null, problem: `файл состояния не разбирается как JSON: ${e.message}` };
  }
  if (typeof state?.profile !== 'string' || !state.profile) {
    return { state: null, problem: 'в файле состояния нет имени профиля (поле profile)' };
  }
  return { state, problem: null };
}

/**
 * One journal line per boot-apply run — P3-AC2's meter. APPEND, never overwrite: the series of the
 * owner's natural logons IS the acceptance evidence, and a journal that keeps only the last line
 * cannot count to five.
 */
export function appendBootJournal(record, filePath = BOOT_JOURNAL_PATH) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify({ at: localIso(), ...record }) + '\n');
}

/**
 * НАМЕРЕНИЕ ВОССТАНОВИТЬ РЕЖИМ — записано и `fsync`-нуто ДО первого байта в карту.
 *
 * Тот же приём и та же причина, что у журнала упреждающей записи развёртки (R15): обычная запись
 * возвращается из кэша страниц ОС, а смерть машины уносит кэш с собой. Здесь это важнее вдвойне —
 * запись делается на ЗАГРУЗКЕ, то есть ровно там, где смерть машины означает следующую загрузку, и
 * следующую, и следующую.
 *
 * Намерение без вердикта на СЛЕДУЮЩЕМ запуске И ЕСТЬ ответ: машина умерла с этим режимом на карте.
 *
 * [NOT-TESTED]
 */
export function appendBootIntent(record, filePath = BOOT_JOURNAL_PATH) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify({ at: localIso(), state: 'intent', ...record }) + '\n';
  const fd = openSync(filePath, 'a');
  try { writeSync(fd, line, null, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * ПРЕРЫВАТЕЛЬ ПЕТЛИ ЗАГРУЗКИ — и он заменяет собой флаг `qualified` на неприсутственном пути.
 *
 * 🔴 ЗАЧЕМ ОН ВООБЩЕ ПОЯВИЛСЯ. Флаг `qualified` придуман агентом и делал ОДНУ настоящую работу:
 * не давал восстанавливать при каждом входе профиль, чьи числа не проверены. Владелец 2026-08-23
 * снял его на пути ЯРЛЫКА («его клик и есть решение о приёмке»), и правильно: там флаг спорил с
 * инстанцией приёмки. Но на пути ЛОГОНА работа флага реальна — плохой режим давал бы петлю
 * загрузки на рабочей машине.
 *
 * Флаг эту работу делал ПЛОХО: он булев, проставляется рукой, ничего не измеряет и дублирует то,
 * что документ кривой знает поимённо (`origin:measured` · `inherited` · `lever-limited`) — пара
 * «правда ↔ зеркало», про которые канон предупреждает. Здесь он заменён механизмом, который
 * наблюдает НАСТОЯЩИЙ отказ, а не его обещание.
 *
 * ПРАВИЛО: если в журнале есть намерение восстановить ЭТОТ профиль, за которым не последовало
 * вердикта, — машина умерла с ним на карте. Восстановление блокируется, пока владелец не применит
 * режим заново своей рукой (его `--apply` кладёт в журнал строку `owner-cleared`, и она снимает
 * блок). Запомненное состояние при этом НЕ переписывается: восстановление не есть новое решение
 * владельца, и отменять его выбор за него нельзя.
 *
 * @returns {{blocked: boolean, why: string, at: string|null}}
 *
 * [NOT-TESTED]
 */
export function bootLoopBreaker(records, profileName) {
  if (!profileName || profileName === 'factory') return { blocked: false, why: '', at: null };
  let orphan = null;
  for (const r of records) {
    if (!r || r.unparsable) continue;
    if (r.state === 'intent') { if (r.remembered === profileName) orphan = r; continue; }
    // ЛЮБАЯ последующая строка про ЭТОТ профиль закрывает намерение: вердикт означает, что процесс
    // дожил до вывода, а `owner-cleared` — что владелец применил режим заново своей рукой.
    if (r.remembered === profileName) orphan = null;
  }
  if (!orphan) return { blocked: false, why: '', at: null };
  return {
    blocked: true,
    at: orphan.at ?? null,
    why: `предыдущее восстановление «${profileName}» (${orphan.at ?? 'без отметки'}) не оставило вердикта — `
      + 'машина умерла с этим режимом на карте. Восстановление ОСТАНОВЛЕНО, чтобы не повторять это '
      + 'каждый вход. Заводское состояние стоит по физике. Снять блок: применить режим ярлыком заново',
  };
}

/** The journal, parsed; unreadable lines are returned as `{ unparsable }` rather than dropped. */
export function readBootJournal(filePath = BOOT_JOURNAL_PATH) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return { unparsable: l }; }
  });
}
