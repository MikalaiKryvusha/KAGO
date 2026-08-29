# Bug 18 — a profile with `settings.curveRef` can NEVER be applied: the CLI resolves the reference and then throws the resolution away

**Status:** ✅ ЗАКРЫТ 2026-08-30 (ревизия сессии 65) — починка в коде, три сторожа по имени тикета, репро прогнано
**Version/build:** `main` @ `dce8007` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-16, found while answering the owner's ask *«пора бы научиться привязывать
профили к нашим ярлыкам на рабочем столе, и к автозапуску, и к процессу в трее ОС»*. Found by a
probe, not by reading — see Forensics.

## Symptom

`profiles/README.md` and `plans/14` §4.3 promise that a profile may name a tuning-curve document
(`settings.curveRef: "measured"`) and the applier resolves it to the same
`{deltaByPointMhz, capMhz}` shape the inline key produces. **It does not.** Every path that applies
a profile throws before touching the card:

```
probe-curveref: THREW -> ссылка на кривую «measured» не разрешена: загрузчик не передан (loadCurve)
```

This is the shape the THREE SHIPPED MODES are supposed to take (`plans/13` phase 5: *«Три файла
профиля, ссылающихся на один документ кривой · различие ровно в двух полях»*). So the sweep can
measure a perfect curve and no shortcut, no logon task and no tray click can put it on the card.

**Why nobody noticed:** all three mode files still carry the OLD scalar form
(`curveRaiseAndCapMhz: {deltaMhz: 592}`), and all three are `qualified: false`, so the
qualification gate refuses them *earlier* — at a line that prints a different reason. The
qualification gate has been masking this defect since phase 1 of epic 02.

## Repro (deterministic, offline, no GPU)

`automation-engine/lib/profile-manager.mjs` exports both `apply` and `fakeBackend`, so the defect
reproduces with no card:

```js
import { apply, fakeBackend } from '<repo>/automation-engine/lib/profile-manager.mjs';
const p = { name: 'p', title: 'p', mode: 'optimised', qualified: true,
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: null,
              curveRaiseAndCapMhz: null, curveRef: 'measured' },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-16T00:00:00+03:00' } };
await apply(fakeBackend(), p, { card: CARD, timing: FAST, curveBackend: fakeCurve() });
// throws: «ссылка на кривую "measured" не разрешена: загрузчик не передан (loadCurve)»
```

The same call with `curveRaiseAndCapMhz` instead of `curveRef` applies cleanly — that is the
control, and it is what makes the finding a defect rather than a broken fixture.

## Forensics — the exact lines

Three sites, and the defect is the seam between them:

| Line | What it does |
|---|---|
| `profile-manager.mjs:1787` | **The CLI resolves the reference CORRECTLY** — `effectiveCurveSetting(profile, { loadCurve, liveTable: await readLiveCurvePoints(), toOffsets: offsetsFor })` |
| `profile-manager.mjs:1792–1806` | …and uses the result only to decide `needsCurve` and to PRINT the shape to the operator |
| `profile-manager.mjs:1816` | **…then hands `apply()` the RAW PROFILE:** `apply(backend, profile, { card, curveBackend, witness })` — no `loadCurve`, no `liveTable`, no `toOffsets` |
| `profile-manager.mjs:523` | `apply()` resolves the setting a SECOND time: `effectiveCurveSetting(profile, { loadCurve })` — `loadCurve` defaults to `null` → `defaultCurveLoader` → throw |

Two more callers share the fault and are worse, because no human is watching them:

- `profile-manager.mjs:887` — `bootApply()` (the logon task, `\KAGO\boot-apply`)
- `profile-manager.mjs:788` — the `--roundtrip` prover

Even if `loadCurve` were threaded through, `apply()` would throw one line later at
`effectiveCurveSetting`'s own guard (`profile-manager.mjs:442`): *«живая таблица карты не
передана»*. The conversion needs a LIVE table read, and `apply()` has no way to get one.

## Root cause

**The same setting is resolved in two places, and only one of them is wired.** This is exactly the
truth↔mirror class `AGENT_GUIDE.md` keeps a registry for — except this pair was created *inside one
module*, which is the same shape EXP-0077 caught in `sweepRange` (two places naming the rung's
frequency). A weak reading of either site alone looks correct: the CLI's resolution is complete and
careful, and `apply()`'s guard is a proper refusal. The defect lives only in the gap.

The deeper cause is a layering problem stated honestly in the code's own comment at
`profile-manager.mjs:1781`: only the CLI may `await import` the curve store, because the store
transitively pulls the card probes. So the resolution CANNOT move into `apply()` as-is — it must be
INJECTED. The injection point exists (`apply`'s `loadCurve` option, added and never used); what is
missing is `liveTable` / `toOffsets` on the same option bag, and the three call sites passing them.

## Fix plan

**Collapse the pair rather than watch it** (`AGENT_GUIDE.md`: a pair that can be REMOVED beats a
pair that must be watched). The CLI already computed `effCurve`; `apply()` must not recompute it.

1. `apply()` accepts the RESOLVED curve as an option — `curve: effCurve` — and calls
   `effectiveCurveSetting` only when it was not given one. One resolution per apply, by construction.
2. `bootApply()` (line 887) and `--roundtrip` (line 788) resolve it the same way before calling
   `apply()`. **The logon task is the one that matters most** — it is unattended, and today it would
   fail a `curveRef` mode on every boot with a message nobody reads.
3. **Guard, proved red first** (EXP-0008): a block in `profile --selftest` that applies a
   `curveRef` profile through a fake backend and asserts the per-point vector REACHED the fake
   curve backend. Mutation addressees named before the run: (a) drop `curve` from `apply`'s options
   → must redden; (b) let `apply` fall back to a silent `null` curve instead of throwing → must
   redden, because that is the «profile that reads as tuning the card and writes nothing» defect
   `profiles/README.md` exists against; (c) resolve in `bootApply` but not pass it → must redden.
4. **The three mode files migrate from `curveRaiseAndCapMhz` to `curveRef`** — a separate step, and
   it waits until the curve document stops moving (the live sweep of 2026-08-16 is writing it).

**Blast radius** (`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §3): `profile-manager.mjs` is R1, the only
writer — `engine.mjs`, `setup-desktop.mjs` and the tray reset path all sit downstream. R1 is NOT
touched by this fix: the change is what `apply()` is TOLD, never who writes.

## What this does NOT block

The shell itself is whole and needs no work: 4 desktop shortcuts, 7 scheduler tasks, the logon
re-apply and the tray are standing live since phase 3 (`plans/06_DONE`). The owner's ask is not
«bind profiles to shortcuts» — that binding exists. It is this seam plus the qualification gate.

## Decisions made without the owner

<filled at closing>

## Links

- `bugs/11` — the BSOD from the OLD scalar form these profiles still carry; migrating them to
  `curveRef` is part of retiring that shape.
- `plans/13` §4 — phase 5's gate, which also owns the un-measured-document applicability guard (R17).
- `plans/14` §4.3 — where `curveRef` was specified.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R1, R14 — the one writer, the one document author.
- EXP-0077 — the same «two places name one fact inside one function» shape, in `sweepRange`.

---

## ✅ СТАТУС: ЗАКРЫТ (2026-08-30, ревизия беклога сессии 65)

**Тикет был починен и лежал открытым.** Ровно класс `bugs/25`: шапка `🔴 OPEN` пережила и
починку, и сторожей, поставленных под неё.

### Чем доказано — четырьмя независимыми уликами

**1. Шов, названный в «Forensics», закрыт, и код ссылается на ЭТОТ тикет.** В пути CLI:

```js
// `curve: effCurve` — the resolution above is HANDED OVER, not recomputed (`bugs/18`).
r = await apply(backend, profile, { card, curveBackend, curve: effCurve, consent });
```

**2. Двое других вызывающих, «которых не смотрит человек», закрыты тем же способом:**
`bootApply()` (задача входа в систему) передаёт `curve: wantCurve`; `apply()` получил параметр
`curve` с прямой запиской «ONE RESOLUTION PER APPLY (`bugs/18`)», а резолвер помечен
«THE ONE RESOLVER EVERY CALLER USES».

**3. Три блока набора `profile --selftest` держат это красным, и все трое названы тикетом:**

| блок | что держит |
|---|---|
| «ССЫЛКА: разрешение ВЫЗЫВАЮЩЕГО доезжает до карты — apply не разрешает второй раз (bugs/18)» | сам шов |
| «ССЫЛКА: null это ОТВЕТ „кривой нет“, а не „разреши сам“ (bugs/18)» | граница: отсутствие кривой не превращается в повторное разрешение |
| «загрузка: режим БЕЗ кривой не открывает бэкенд кривой вовсе (bugs/18)» | не открывать `nvapi64.dll` даром |

**4. Репро тикета прогнано сегодня, обе ветки** (`fakeBackend`, карты нет, записей ноль):

```
ВЕТКА 1 (как звал сломанный вызывающий, без curve):
  ОТКАЗ — «ссылка на кривую „measured“ не разрешена: загрузчик не передан (loadCurve)»
  ← ошибка тикета воспроизводится ДОСЛОВНО: дефектная форма вызова всё ещё даёт ту самую строку
ВЕТКА 2 (как зовёт CLI сегодня, curve передан):
  этой ошибки НЕТ — прогон уходит дальше, к законной проверке «бэкенд кривой не передан»
```

Вторая ветка — то, что делает вывод выводом, а не впечатлением: **исчезла именно та ошибка**,
а не все ошибки сразу.

### Что НЕ проверено, и это названо, а не спрятано

Третья ветка — довести `apply` до КОНЦА на подставном бэкенде кривой — не доведена: подставная
карта требует формы, которой у неё в этой пробе не оказалось (`Cannot read properties of
undefined (reading 'min')`). Это дефект МОЕЙ пробы, а не кода — та же дорога проходится блоками
набора целиком. Останавливаться на этом дольше значило бы переписывать своими руками то, что
набор уже делает.

**Остаётся верным предупреждение тикета:** три файла режимов по-прежнему несут старую скалярную
форму и `qualified: false`, поэтому гейт квалификации отвергает их РАНЬШЕ и по другой причине.
Это не этот дефект — это фаза 6 эпика 01 (квалификация режимов), и она открыта.

## Решения, принятые без владельца

| # | решение | почему так, и чем отменить |
|---|---|---|
| 1 | **Закрыт по уликам починки и репро, а не по новому сквозному прогону на карте** | Прогон на карте требует вечера при владельце и записи в GPU; шов доказан там, где живёт, — в наборе. Отменяется первым же живым применением профиля с `curveRef`, если оно откажет |
| 2 | **Незавершённая третья ветка пробы названа, а не убрана** | Проба, о которой умолчали, — это отчёт об успехах; названная — приглашение перепроверить |
