#!/usr/bin/env node
// twin-burn-carrier.mjs — the burn's PROCESS BODY on the twin (epic 59 phase 4, `plans/63` шаг 3).
//
// WHY THIS EXISTS. On the live path the burn is a real process (`furnace.exe` inside `spawnSync`),
// and the fuse's hand 1 kills exactly that. On the twin the oracle lives INSIDE the engine process —
// so a death rehearsal had nobody for hand 1 to kill. This carrier is the burn's body: it holds the
// burn's WALL TIME and is killable; the VERDICT stays with the in-process oracle, whose state
// (thermal model, RNG sequence, held offsets) must not be forked into a child (I2 — the twin is not
// softer, and a reseeded child would judge a different card).
//
// THE CONTRACT with the rehearsal launcher (`twin-assembly.mjs`):
//   exit 0        → the burn's time was served; the launcher then asks the in-process oracle.
//   exit ≠ 0      → this process was KILLED (hand 1); the launcher returns the spawnSync result
//                   verbatim, and `runBurst` fails it through its NORMAL status≠0 road — «нагрузка
//                   вышла с кодом …», exactly how a taskkill'ed furnace fails on the live path.
//
// The pidfile is the fuse's TARGET (`fuse --burn-pidfile`): written with fsync BEFORE the sleep so
// the judge can read it mid-burn, deleted on natural exit so a later trip never aims at a corpse
// (a stale pid would go to `process.kill`, which on Windows can hit a RECYCLED pid — deleting is
// cheaper than proving that never matters). It is also the profile player's cue («--after-pidfile»):
// the measured stranglings began while a burn was in flight, so the rehearsal's do too.
//
// [TESTED: 2026-08-28 · twin --selftest блок «НОСИТЕЛЬ …» — happy path served + killed path fails
//  the runBurst road; live rehearsal `--rehearse-death` kills it for real]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSync, fsyncSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const num = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt; };
  const str = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
  const seconds = num('--seconds', 1);
  const pidfile = str('--pidfile', null);
  // ⚡ ВХОД 2 НА ДВОЙНИКЕ (фаза 5в эпика 51, `plans/66`). Живой прожиг трогает файл сердцебиения
  // раз в запуск; носитель обязан делать то же самое, иначе репетиция идёт по дороге, которой на
  // живом пути нет (паритет стендов, эпик 59). Такт передаёт сборка — она знает форму;
  // по умолчанию берётся МАКСИМАЛЬНЫЙ измеренный такт `furnace`, и это осознанно консервативно:
  // предохранитель, не давший ложного трипа на самом медленном такте, не даст его на быстром.
  const progressFile = str('--progress-file', null);
  const progressTickMs = num('--progress-tick-ms', 331);
  // Профиль «прогресс встал при живой машине»: носитель ЖИВ и удары идут, но работа больше не
  // отгружается — это и есть отказ, которого вход 1 не видит по построению.
  const stallAfterMs = num('--progress-stall-after-ms', null);

  const run = async () => {
    if (pidfile) {
      mkdirSync(path.dirname(pidfile), { recursive: true });
      const fd = openSync(pidfile, 'w');
      try { writeSync(fd, `${process.pid}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    }
    // Yielding sleep in one-second slices — the same pulse the twin oracle's own real-seconds burn
    // keeps (`virtual-gpu.mjs` → «SLICED INTO SECONDS»): a body that can say nothing for ten
    // seconds would be a worse model of the burn than one that breathes between slices.
    // Сердцебиение прогресса — на СВОЁМ таймере, как у живого прожига оно висит на своём цикле
    // запусков: тело носителя держит время стены и не должно ни ускоряться, ни замедляться от
    // того, ведём мы счёт запусков или нет.
    let ticks = 0;
    const startedAt = Date.now();
    const progressTimer = progressFile
      ? setInterval(() => {
        if (stallAfterMs !== null && Date.now() - startedAt >= stallAfterMs) return; // работа встала
        ticks += 1;
        const fd = openSync(progressFile, 'w');
        try { writeSync(fd, `${ticks}\n`); } finally { closeSync(fd); }
      }, progressTickMs)
      : null;

    let left = seconds;
    while (left > 0) {
      const slice = Math.min(1, left);
      await new Promise((res) => setTimeout(res, Math.round(slice * 1000)));
      left -= slice;
    }
    if (progressTimer) clearInterval(progressTimer);
    if (pidfile) { try { rmSync(pidfile, { force: true }); } catch { /* the trip may already own it */ } }
    // Файл сердцебиения снимается при штатном выходе — тем же признаком и по той же причине, что
    // на живом пути (`plans/66`): между ступенями прожига нет, и предохранитель обязан отличать
    // «работа встала» от «работы сейчас нет». Паритет дорог важнее экономии одной строки.
    if (progressFile) { try { rmSync(progressFile, { force: true }); } catch { /* уже снят */ } }
    return 0;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
