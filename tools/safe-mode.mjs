/**
 * SAFE MODE FOR THE OWNER'S DISKS — arm, verify, disarm, and above all SAY.
 *
 * Plan: `plans/30_safe_mode_for_the_owners_disks.md`. Owner's decision: `interviews/013` Q3 = **D**.
 *
 * ─── WHY THIS EXISTS, IN MEASURED NUMBERS ─────────────────────────────────────────────────────────
 *
 * Twelve unclean shutdowns since 2026-07-01, and on 2026-08-22 a filesystem was actually damaged:
 * **4996 NTFS corruption records on J: in one day** (`researches/17` §2, `bugs/43`), the same day the
 * machine died three times. The owner accepted the hang risk for his CARD (`GOAL.md` → «ЗАВИСАНИЕ —
 * ОСОЗНАННЫЙ РИСК»). Nobody ever accepted it for his STORAGE.
 *
 * ─── LEVEL 2 IS READ-ONLY, NOT OFFLINE, AND THAT IS A MEASUREMENT ─────────────────────────────────
 *
 * The plan originally proposed `Set-Disk -IsOffline`. The owner asked whether he could still watch a
 * film off the disk. He could not — offline dismounts the volumes and the letters vanish. So the
 * rung was re-measured on 2026-08-23 22:29–22:31 on disk 2 (E:) **while his film was playing off it**,
 * judged by the player's own read counters rather than by impression:
 *
 *   film reading from E:, 6 s window : 16,50 MB / 264 ops  →  17,06 MB / 273 ops   (noticed nothing)
 *   open a NEW file on E:            : 4096 bytes read                             (reads live)
 *   write a file to E:               : «The media is write protected»              (writes refused)
 *   letter · volume · health         : E: · Healthy · OK                           (never dismounted)
 *
 * Level-2 protection at level-1 cost. The refusal comes from BELOW NTFS and below permissions, so it
 * silences every writer at once — FTP and the torrent client included — without any of them knowing
 * KAGO exists. `--offline-disks` keeps the old rung as an explicit opt-in.
 *
 * ⚠️ **NOT measured, and not claimed:** whether `IsReadOnly` survives a reboot. The machine was not
 * rebooted mid-film. It does not change the design — the logon disarm is required either way.
 *
 * ─── WHAT THIS TOOL REFUSES TO DO ─────────────────────────────────────────────────────────────────
 *
 *  • Touch C: or D: — system, journals, registry, pagefile. They write always; that residual is named
 *    rather than papered over (`plans/30` §4).
 *  • Arm the disk its OWN RECEIPT lives on. A receipt on a read-only volume cannot record its own
 *    rollback. This is a GUARD, not a note in a document: the disk hosting the receipt is resolved at
 *    run time and refused. The earlier plan said «put the receipt on C:», which is diligence; this is
 *    machinery, and it keeps holding when someone moves the repo.
 *  • Touch a channel to the machine or someone else's work — Parsec, VPN, the IDE hosting the session,
 *    Docker with running containers (`AGENT_GUIDE.md`, standing rule).
 *
 * ─── DISKS ARE KEYED BY LETTER, NOT BY NUMBER ─────────────────────────────────────────────────────
 *
 * The plan says «disks 0/1/2». Disk NUMBERS are assigned by Windows and can move when hardware
 * changes; a tool that hardcodes them would one day arm the wrong disk in silence — the worst
 * available failure. Letters are resolved to numbers at run time, and a letter that does not resolve
 * is a refusal, never a guess.
 *
 * [NOT-TESTED] at birth — `--selftest` is what flips this.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** The volumes the safe mode protects. C: and D: are deliberately absent — see the header. */
export const PROTECTED_LETTERS = Object.freeze(['J', 'F', 'E']);

/** Where the receipt lives. Same convention as the shell rollbacks already in the tree. */
export const RECEIPT_PATH = resolve(REPO, 'runs', 'shell', 'rollback', 'safe-mode.json');

/** Same shape as `tray-autostart.psRun` — one place that knows how PowerShell is spawned. */
export function psRun(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

const jsonOut = (run, script) => {
  const r = run(`${script} | ConvertTo-Json -Compress -Depth 4`);
  if (!r.ok || !r.stdout) return null;
  try {
    const v = JSON.parse(r.stdout);
    return Array.isArray(v) ? v : [v];
  } catch { return null; }
};

// =================================================================================================
// READING THE MACHINE — every duty answers «armed?» from the MACHINE, never from the receipt
// =================================================================================================

/**
 * ⚠️ THE RECEIPT IS NOT THE TRUTH, IT IS THE UNDO LIST. Asking it «is the mode armed?» would answer
 * about the last run of this tool, not about the machine — and after an unclean shutdown those are
 * exactly the two things that differ. Each duty below reports what the MACHINE says right now; the
 * receipt only supplies what to restore each item TO.
 */
/**
 * ⚠️ `ConvertTo-Json` СЕРИАЛИЗУЕТ СТАТУС СЛУЖБЫ ЧИСЛОМ, и это не косметика. `--status` — то, что
 * человек читает ПОСЛЕ чёрного экрана, чтобы понять, в каком состоянии машина; строка «служба
 * ftpsvc: 4» не отвечает на его вопрос. Замерено на живой машине 2026-08-24: пришло `4`, не
 * `Running`. Числа — из `ServiceControllerStatus`.
 */
const SERVICE_STATUS = Object.freeze({
  1: 'Stopped', 2: 'StartPending', 3: 'StopPending', 4: 'Running',
  5: 'ContinuePending', 6: 'PausePending', 7: 'Paused',
});
export function serviceStatusName(v) {
  if (v === null || v === undefined) return null;
  return SERVICE_STATUS[Number(v)] ?? String(v);
}

export function readMachine({ run = psRun } = {}) {
  const raw = jsonOut(run, "Get-Service -Name ftpsvc -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType")?.[0] ?? null;
  const ftp = raw === null ? null : { ...raw, Status: serviceStatusName(raw.Status) };
  const torrent = jsonOut(run, "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'torrent|qbit|deluge|transmission' } | Select-Object Id,Name,Path")?.[0] ?? null;
  const disks = jsonOut(run,
    "Get-Partition | Where-Object DriveLetter | Select-Object DiskNumber,DriveLetter | ForEach-Object { "
    + "$d = Get-Disk -Number $_.DiskNumber; [pscustomobject]@{ letter = [string]$_.DriveLetter; number = $_.DiskNumber; "
    + "isReadOnly = [bool]$d.IsReadOnly; isOffline = [bool]$d.IsOffline } }") ?? [];
  return { ftp, torrent, disks };
}

/** Which disk hosts a given path — the guard that keeps the receipt reachable. */
export function diskOfPath(path, disks) {
  const letter = String(path ?? '').slice(0, 1).toUpperCase();
  return disks.find((d) => String(d.letter).toUpperCase() === letter) ?? null;
}

/**
 * THE DUTIES, AND WHETHER EACH IS ARMED — pure, so `--selftest` can drive every combination without
 * a machine. The whole point of the tool is this list: `--status` prints it, `--on` acts on the
 * disarmed ones, `--off` restores the armed ones, and the KAGO gate counts them.
 *
 * @returns {Array<{id:string, armed:boolean, what:string, undo:string|null}>}
 */
export function dutiesOf(machine, { offline = false, receiptPath = RECEIPT_PATH } = {}) {
  const out = [];
  const ftp = machine?.ftp ?? null;
  out.push({
    id: 'ftpsvc',
    // Нормализовано в `readMachine`; число здесь принимается тоже — фикстуры селфтеста и живой
    // PowerShell не обязаны договариваться о форме, а сторож не должен зависеть от того, кто его звал.
    armed: ftp !== null && serviceStatusName(ftp.Status) !== 'Running',
    what: ftp === null ? 'служба ftpsvc не установлена — дежурство неприменимо' : `служба ftpsvc: ${ftp.Status}`,
    undo: ftp === null ? null : 'Start-Service ftpsvc',
    absent: ftp === null,
  });
  out.push({
    id: 'torrent',
    armed: machine?.torrent == null,
    what: machine?.torrent == null ? 'торрент-клиент не запущен' : `торрент-клиент ${machine.torrent.Name} (pid ${machine.torrent.Id})`,
    undo: machine?.torrent?.Path ? `Start-Process ${JSON.stringify(machine.torrent.Path)}` : null,
  });
  const hostDisk = diskOfPath(receiptPath, machine?.disks ?? []);
  for (const letter of PROTECTED_LETTERS) {
    const d = (machine?.disks ?? []).find((x) => String(x.letter).toUpperCase() === letter);
    if (!d) {
      // A letter that does not resolve is an ANSWER — «cannot be armed, and here is why» — never a guess.
      out.push({ id: `disk:${letter}`, armed: false, what: `том ${letter}: не найден — арматура неприменима`, undo: null, absent: true });
      continue;
    }
    // ⚠️ THE RECEIPT'S OWN DISK IS NEVER ARMED. Machinery, not a note in a plan.
    if (hostDisk && hostDisk.number === d.number) {
      out.push({
        id: `disk:${letter}`,
        armed: false,
        what: `том ${letter}: (диск ${d.number}) НЕСЁТ РАСПИСКУ ОТКАТА — зажимать его нельзя, иначе откат себя не запишет`,
        undo: null,
        refusedByGuard: true,
      });
      continue;
    }
    out.push({
      id: `disk:${letter}`,
      armed: offline ? Boolean(d.isOffline) : Boolean(d.isReadOnly),
      what: `том ${letter}: (диск ${d.number}) read-only=${d.isReadOnly} offline=${d.isOffline}`,
      undo: offline ? `Set-Disk -Number ${d.number} -IsOffline $false` : `Set-Disk -Number ${d.number} -IsReadOnly $false`,
      diskNumber: d.number,
    });
  }
  return out;
}

/**
 * DISARMED · ARMED · **HALF-ARMED** — and the third is the one the whole plan is about.
 *
 * A machine that died mid-arming leaves some duties on and some off. Nobody notices, because a
 * half-protected machine looks exactly like a working one. AC4 turns that into a refusal: the sweep
 * will not write to the card while this says `half-armed`.
 *
 * ⚠️ **Duties that CANNOT be performed do not count as either side.** An absent FTP service and a
 * disk that carries the receipt are not «unarmed items» — treating them as such would make the state
 * permanently half-armed and the gate would redden on the normal operating state. That is the trap
 * R12 · R13 · R17 all name, and this project has fallen into it twice (`plans/30` §2.4).
 */
export function safeModeState(duties) {
  const applicable = (duties ?? []).filter((d) => !d.absent && !d.refusedByGuard);
  if (!applicable.length) return { state: 'disarmed', armed: [], disarmed: [], why: 'ни одно дежурство неприменимо на этой машине' };
  const armed = applicable.filter((d) => d.armed);
  const disarmed = applicable.filter((d) => !d.armed);
  if (!armed.length) return { state: 'disarmed', armed, disarmed, why: 'безопасный режим не взведён' };
  if (!disarmed.length) return { state: 'armed', armed, disarmed, why: 'безопасный режим взведён полностью' };
  return {
    state: 'half-armed',
    armed,
    disarmed,
    why: `ВЗВЕДЁН НАПОЛОВИНУ: ${armed.map((d) => d.id).join(', ')} — да, а ${disarmed.map((d) => d.id).join(', ')} — нет`,
  };
}

// =================================================================================================
// THE RECEIPT — written and fsynced BEFORE the first state change (AC3)
// =================================================================================================

/**
 * ⚠️ `fsync` BEFORE THE FIRST CHANGE, and the reasoning is R15's, unchanged: a machine that dies takes
 * the page cache with it, and a receipt that is durable only when nothing went wrong is durable
 * exactly never when it matters. This tool exists BECAUSE the machine dies.
 */
export function writeReceipt(items, { path = RECEIPT_PATH, at = null, io = {} } = {}) {
  const open = io.openSync ?? openSync;
  const write = io.writeSync ?? writeSync;
  const sync = io.fsyncSync ?? fsyncSync;
  const close = io.closeSync ?? closeSync;
  const mkdir = io.mkdirSync ?? mkdirSync;
  mkdir(dirname(path), { recursive: true });
  const body = `${JSON.stringify({ kind: 'safe-mode-receipt', at: at ?? new Date().toISOString(), items }, null, 2)}\n`;
  const fd = open(path, 'w');
  try { write(fd, body, null, 'utf8'); sync(fd); } finally { close(fd); }
  return { ok: true, path, items: items.length };
}

export function readReceipt({ path = RECEIPT_PATH } = {}) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// =================================================================================================
// THE ACTIONS
// =================================================================================================

const say = (s) => console.log(s);

export function printStatus({ run = psRun, offline = false } = {}) {
  const duties = dutiesOf(readMachine({ run }), { offline });
  const st = safeModeState(duties);
  say(`\nБЕЗОПАСНЫЙ РЕЖИМ ДЛЯ ДИСКОВ — ${st.state.toUpperCase()}`);
  say(`  ${st.why}\n`);
  for (const d of duties) {
    const mark = d.absent || d.refusedByGuard ? '·' : (d.armed ? '🔒' : '○');
    say(`  ${mark} ${d.id.padEnd(10)} ${d.what}`);
  }
  const receipt = readReceipt();
  say(receipt
    ? `\n  расписка отката: ${RECEIPT_PATH} (${receipt.items?.length ?? 0} пунктов, от ${receipt.at})`
    : '\n  расписки отката нет — режим этим инструментом не взводили');
  if (st.state === 'half-armed') {
    say('\n  ⚠️ ВЗВЕДЁН НАПОЛОВИНУ. Прогон KAGO писать в карту откажется (plans/30 AC4).');
    say('     Снять: node tools/safe-mode.mjs --off');
  }
  return st;
}

/** Every duty in its OWN `try` — R10a: a list, never a chain; the first throw must not cancel the rest. */
function eachDuty(items, fn) {
  const done = []; const failed = [];
  for (const it of items) {
    try {
      const r = fn(it);
      if (r?.ok) done.push(it.id); else failed.push({ id: it.id, why: r?.why ?? 'без причины' });
    } catch (e) { failed.push({ id: it.id, why: String(e?.message ?? e) }); }
  }
  return { done, failed };
}

export function arm({ run = psRun, offline = false, at = null } = {}) {
  const machine = readMachine({ run });
  const duties = dutiesOf(machine, { offline });
  const todo = duties.filter((d) => !d.armed && !d.absent && !d.refusedByGuard);
  for (const d of duties.filter((x) => x.refusedByGuard)) say(`  ⛔ ${d.what}`);
  if (!todo.length) { say('  всё, что применимо, уже взведено'); return { ok: true, done: [], failed: [] }; }

  // ⚠️ РАСПИСКА ДО ПЕРВОГО ИЗМЕНЕНИЯ СОСТОЯНИЯ (AC3) — не после, не «в конце».
  writeReceipt(todo.map((d) => ({ id: d.id, was: d.what, undo: d.undo })), { at });
  say(`  расписка отката записана и сброшена на диск: ${RECEIPT_PATH}`);

  const r = eachDuty(todo, (d) => {
    if (d.id === 'ftpsvc') return run('Stop-Service ftpsvc -Force').ok ? { ok: true } : { ok: false, why: 'Stop-Service не прошла' };
    if (d.id === 'torrent') {
      // Мягко: закрыть окно и дать сохраниться. Убийство писателя посреди записи — ровно то, от чего
      // этот инструмент и защищает, так что форсировать нельзя.
      const res = run(`$p = Get-Process -Id ${machine.torrent.Id} -ErrorAction SilentlyContinue; `
        + 'if ($p) { $null = $p.CloseMainWindow(); Start-Sleep -Seconds 3 }; '
        + `if (Get-Process -Id ${machine.torrent.Id} -ErrorAction SilentlyContinue) { 'ALIVE' } else { 'CLOSED' }`);
      return res.stdout.includes('CLOSED') ? { ok: true } : { ok: false, why: 'клиент не закрылся по-хорошему; форсировать не буду — это и есть тот риск' };
    }
    if (d.id.startsWith('disk:')) {
      const flag = offline ? '-IsOffline $true' : '-IsReadOnly $true';
      // Кэш тома сбрасывается ДО зажатия: грязные страницы, оставшиеся над read-only томом, —
      // ровно та запись, которую мы и убираем.
      run(`Write-VolumeCache -DriveLetter ${d.id.slice(5)} -ErrorAction SilentlyContinue`);
      return run(`Set-Disk -Number ${d.diskNumber} ${flag}`).ok ? { ok: true } : { ok: false, why: 'Set-Disk не прошла' };
    }
    return { ok: false, why: 'неизвестное дежурство' };
  });
  for (const f of r.failed) say(`  ❌ ${f.id}: ${f.why}`);
  say(`  взведено: ${r.done.length}, не удалось: ${r.failed.length}`);
  return { ok: r.failed.length === 0, ...r };
}

export function disarm({ run = psRun } = {}) {
  const receipt = readReceipt();
  if (!receipt) { say('  расписки нет — восстанавливать нечего по документу; сверься с --status'); return { ok: true, done: [], failed: [] }; }
  const r = eachDuty(receipt.items ?? [], (it) => {
    if (!it.undo) return { ok: false, why: 'в расписке нет команды отката' };
    return run(it.undo).ok ? { ok: true } : { ok: false, why: `откат не прошёл: ${it.undo}` };
  });
  for (const f of r.failed) say(`  ❌ ${f.id}: ${f.why}`);
  say(`  восстановлено: ${r.done.length} из ${(receipt.items ?? []).length}, не удалось: ${r.failed.length}`);
  return { ok: r.failed.length === 0, ...r };
}

/**
 * AC9 — ПРОВЕРКА НАБЛЮДЕНИЕМ, А НЕ ПРЕДПОЛОЖЕНИЕМ. Одна проба чтения и одна проба записи на КАЖДЫЙ
 * том. Замерена была только E: (см. шапку); про J: и F: мы не знаем ничего, и «наверное так же» — не
 * замер. Проба записи, которая ПРОШЛА под взведённым режимом, есть отказ режима и отчитывается как
 * отказ, а не проглатывается.
 */
export function verify({ run = psRun } = {}) {
  const rows = [];
  for (const letter of PROTECTED_LETTERS) {
    const res = run(`$L='${letter}'; $out=@{}; `
      + '$out.present = [bool](Get-Volume -DriveLetter $L -ErrorAction SilentlyContinue); '
      // ⚠️ РЕКУРСИВНО, И ЭТО ПОЧИНКА ПО ЖИВОМУ ЗАМЕРУ 2026-08-24. Первая редакция смотрела только в
      // КОРЕНЬ тома и на всех трёх дисках владельца вернула «нечего пробовать»: файлы лежат в
      // подкаталогах, а в корнях — одни папки. То есть половина AC9, ради которой read-only и выбран
      // вместо офлайна (ЧТЕНИЕ ЖИВО), инструментом не проверялась вовсе — он молча отчитывался ни о
      // чём. `Select-Object -First 1` обрывает конвейер на первом файле, так что обход не идёт вглубь.
      + 'try { $f = Get-ChildItem "${L}:\\" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1; '
      + 'if ($f) { $fs=[IO.File]::OpenRead($f.FullName); $b=New-Object byte[] 512; $null=$fs.Read($b,0,512); $fs.Close(); $out.read=$true } else { $out.read=$null } } catch { $out.read=$false }; '
      + 'try { [IO.File]::WriteAllText("${L}:\\kago-safe-mode-probe.tmp","p"); [IO.File]::Delete("${L}:\\kago-safe-mode-probe.tmp"); $out.write=$true } catch { $out.write=$false }; '
      + '[pscustomobject]$out | ConvertTo-Json -Compress');
    let v = null;
    try { v = JSON.parse(res.stdout); } catch { v = null; }
    rows.push({ letter, present: v?.present ?? null, read: v?.read ?? null, write: v?.write ?? null });
  }
  say('\n  ПРОВЕРКА ПО КАЖДОЙ БУКВЕ (AC9):');
  for (const r of rows) {
    say(`   ${r.letter}:  том ${r.present ? 'на месте' : 'ОТСУТСТВУЕТ'} · чтение ${r.read === null ? 'нечего пробовать' : (r.read ? 'работает' : 'НЕ РАБОТАЕТ')}`
      + ` · запись ${r.write ? '⚠️ ПРОШЛА (том НЕ защищён)' : 'отбита'}`);
  }
  return rows;
}

// =================================================================================================
// SELFTEST — offline, on injected seams, and it ships WITH the code, not later
// =================================================================================================

function selftest() {
  let green = 0; let red = 0;
  const ok = (name, got, want) => {
    const g = JSON.stringify(got); const w = JSON.stringify(want);
    if (g === w) { green += 1; console.log(`  OK   ${name}`); } else { red += 1; console.log(`  ПЛОХО ${name}\n       получено ${g}, ждали ${w}`); }
  };
  const disks = [
    { letter: 'J', number: 0, isReadOnly: false, isOffline: false },
    { letter: 'F', number: 1, isReadOnly: false, isOffline: false },
    { letter: 'E', number: 2, isReadOnly: false, isOffline: false },
    { letter: 'C', number: 3, isReadOnly: false, isOffline: false },
    { letter: 'D', number: 4, isReadOnly: false, isOffline: false },
  ];
  const machine = (over = {}) => ({
    ftp: { Name: 'ftpsvc', Status: 'Running', StartType: 'Automatic' },
    torrent: { Id: 1, Name: 'qbittorrent', Path: 'C:\\q.exe' },
    disks,
    ...over,
  });
  const onD = 'D:\\work\\KAGO\\runs\\shell\\rollback\\safe-mode.json';

  console.log('\n— СОСТОЯНИЕ: три, и третье — то, ради чего всё —');
  ok('ничего не тронуто → DISARMED',
    safeModeState(dutiesOf(machine(), { receiptPath: onD })).state, 'disarmed');
  ok('всё зажато → ARMED', safeModeState(dutiesOf(
    machine({ ftp: { Status: 'Stopped' }, torrent: null, disks: disks.map((d) => ([0, 1, 2].includes(d.number) ? { ...d, isReadOnly: true } : d)) }),
    { receiptPath: onD },
  )).state, 'armed');
  ok('FTP стоит, а диски нет → HALF-ARMED, и это НАЗВАНО',
    (() => { const s = safeModeState(dutiesOf(machine({ ftp: { Status: 'Stopped' } }), { receiptPath: onD })); return [s.state, s.why.includes('ftpsvc')]; })(),
    ['half-armed', true]);

  console.log('\n— СТОРОЖ РАСПИСКИ: диск, несущий откат, не зажимается —');
  ok('расписка на E: → E: ИСКЛЮЧЁН из зажатия, и причина названа',
    (() => {
      const d = dutiesOf(machine(), { receiptPath: 'E:\\rollback\\safe-mode.json' }).find((x) => x.id === 'disk:E');
      return [Boolean(d.refusedByGuard), d.what.includes('РАСПИСКУ')];
    })(), [true, true]);
  ok('и он НЕ делает состояние вечно-половинчатым — иначе гейт краснел бы на штатной машине',
    safeModeState(dutiesOf(
      machine({ ftp: { Status: 'Stopped' }, torrent: null, disks: disks.map((d) => ([0, 1].includes(d.number) ? { ...d, isReadOnly: true } : d)) }),
      { receiptPath: 'E:\\rollback\\safe-mode.json' },
    )).state, 'armed');
  ok('расписка на D: (вне защищаемых) → все три тома зажимаются',
    dutiesOf(machine(), { receiptPath: onD }).filter((d) => d.id.startsWith('disk:') && !d.refusedByGuard).length, 3);

  console.log('\n— НЕПРИМЕНИМОЕ НЕ СЧИТАЕТСЯ НИ ЗА, НИ ПРОТИВ —');
  ok('нет службы FTP → дежурство неприменимо, а не «не взведено»',
    (() => { const d = dutiesOf(machine({ ftp: null }), { receiptPath: onD }).find((x) => x.id === 'ftpsvc'); return [Boolean(d.absent), d.armed]; })(),
    [true, false]);
  ok('и машина со снятыми дисками, но без FTP-службы, читается как ARMED, а не half',
    safeModeState(dutiesOf(
      machine({ ftp: null, torrent: null, disks: disks.map((d) => ([0, 1, 2].includes(d.number) ? { ...d, isReadOnly: true } : d)) }),
      { receiptPath: onD },
    )).state, 'armed');
  ok('пропавшая буква — ОТВЕТ, а не догадка',
    (() => { const d = dutiesOf(machine({ disks: disks.filter((x) => x.letter !== 'J') }), { receiptPath: onD }).find((x) => x.id === 'disk:J'); return [Boolean(d.absent), d.undo]; })(),
    [true, null]);

  console.log('\n— РЕЖИМ OFFLINE СУДИТСЯ СВОИМ ФЛАГОМ, А НЕ ЧУЖИМ —');
  ok('под --offline-disks read-only взведённым НЕ считается: это разные дежурства',
    safeModeState(dutiesOf(
      machine({ ftp: { Status: 'Stopped' }, torrent: null, disks: disks.map((d) => ([0, 1, 2].includes(d.number) ? { ...d, isReadOnly: true } : d)) }),
      { offline: true, receiptPath: onD },
    )).state, 'half-armed');
  ok('и откат в offline-режиме снимает ИМЕННО офлайн',
    dutiesOf(machine(), { offline: true, receiptPath: onD }).find((d) => d.id === 'disk:E').undo,
    'Set-Disk -Number 2 -IsOffline $false');

  console.log('\n— СТАТУС СЛУЖБЫ ЧИТАЕТСЯ И ЧИСЛОМ, И СЛОВОМ (замер живой машины 2026-08-24) —');
  ok('число 4 = Running → дежурство НЕ взведено', serviceStatusName(4), 'Running');
  ok('число 1 = Stopped → взведено', serviceStatusName(1), 'Stopped');
  ok('и сторож судит одинаково, пришло ли число или слово',
    [dutiesOf(machine({ ftp: { Status: 4 } }), { receiptPath: onD }).find((d) => d.id === 'ftpsvc').armed,
      dutiesOf(machine({ ftp: { Status: 'Running' } }), { receiptPath: onD }).find((d) => d.id === 'ftpsvc').armed,
      dutiesOf(machine({ ftp: { Status: 1 } }), { receiptPath: onD }).find((d) => d.id === 'ftpsvc').armed],
    [false, false, true]);

  console.log('\n— ОТКАТ ЭТО СПИСОК, А НЕ ЦЕПЬ (R10a) —');
  ok('падение на первом пункте НЕ отменяет остальные',
    (() => {
      const calls = [];
      const fakeRun = (s) => { calls.push(s); return { ok: !s.includes('BOOM'), stdout: '', stderr: '' }; };
      const r = eachDuty([{ id: 'a', undo: 'BOOM' }, { id: 'b', undo: 'fine' }, { id: 'c', undo: 'fine2' }],
        (it) => (fakeRun(it.undo).ok ? { ok: true } : { ok: false, why: 'x' }));
      return [r.done, r.failed.map((f) => f.id), calls.length];
    })(), [['b', 'c'], ['a'], 3]);

  console.log(`\nСАМОПРОВЕРКА safe-mode: ${green} зелёных, ${red} красных.`);
  return red === 0;
}

// =================================================================================================
// CLI — `--status` is the DEFAULT, and it is read-only
// =================================================================================================

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const offline = has('--offline-disks');
  if (has('--selftest')) process.exit(selftest() ? 0 : 1);
  else if (has('--on')) { const r = arm({ offline }); printStatus({ offline }); process.exit(r.ok ? 0 : 1); }
  else if (has('--off')) { const r = disarm(); printStatus({ offline }); process.exit(r.ok ? 0 : 1); }
  else if (has('--verify')) { verify(); process.exit(0); }
  else { const st = printStatus({ offline }); process.exit(st.state === 'half-armed' ? 1 : 0); }
}
