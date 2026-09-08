/**
 * ⏱️ РАЗРЕШЕНИЕ ТАЙМЕРА — ОДНО ОПРЕДЕЛЕНИЕ НА ВЕСЬ ПРОЕКТ.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ. `loadWinmm()` жил ДВАЖДЫ — в `death-watch.mjs` и в `fuse.mjs`, семь
 * мест вызова. Пару лучше убрать, чем за ней следить (DRY), и починка `bugs/128` — ровно тот
 * случай, когда за парой не уследили бы: лекарство обязано стоять во ВСЕХ семи, а не в тех, что
 * вспомнили.
 *
 * 🔴 ЧТО ЗДЕСЬ ПОЧИНЕНО, И ЭТО ОПЛАЧЕНО ЧЕТЫРЬМЯ СМЕРТЯМИ МАШИНЫ 2026-09-08.
 *
 * `bugs/128`: чёрный ящик объявлял такт 2 мс, а в записи смерти 17:53 мерилось 13,99 мс — ровно
 * там, где улика была нужна. Причина найдена 2026-09-09 (`plans/94` шаг 2) и она НЕ в нагрузке:
 *
 *   опыт                                          секунда 3      секунда 19
 *   тот же цикл 2 мс в КОНСОЛИ, 15 с              2,24 мс        2,24 мс     ← развала нет вовсе
 *   тот же цикл СКРЫТЫМ отсоединённым процессом   15,40 мс       15,46 мс    ← развал, БЕЗ КАРТЫ
 *   он же + отказ от гашения (ниже)                2,02 мс        2,05 мс    ← вылечен
 *
 * Механизм: Windows 11 применяет к ФОНОВОМУ процессу EcoQoS (Power Throttling), и в него входит
 * `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION` — запрос `timeBeginPeriod(1)` принимается и
 * МОЛЧА игнорируется. Судья и проба живого прогона запускаются именно так: отсоединёнными, с
 * `windowsHide: true`. Поэтому они теряли разрешение через 3-5 секунд после старта и НЕ
 * ВОССТАНАВЛИВАЛИ его до конца прогона — в записи 17:53 такт остался 15,3 мс даже после того, как
 * прожиг кончился и нагрузка ушла (секунды 14-24). Нагрузка так себя не ведёт, а гашение — да.
 *
 * ⚠️ ПОЧЕМУ ЭТОГО НЕ ЗАМЕТИЛИ ПЯТЬ ДНЕЙ, И ЭТО ГЛАВНЫЙ УРОК ФАЙЛА. Прибор, который обязан был
 * закричать, всё это время рапортовал «всё хорошо»: `NtQueryTimerResolution` печатал 0,5 мс на
 * КАЖДОЙ секунде развала. Он читает разрешение СИСТЕМЫ, а гасят его ПРОЦЕССУ. Поэтому
 * свидетелем здесь работает не он, а НАБЛЮДЁННЫЙ ЗАЗОР — величина, которую гашение подделать не
 * может. Тот же класс, что `bugs/124`: прибор измеряет не то, что называет.
 */
import { createRequire } from 'node:module';

// koffi ездит на CommonJS — `createRequire`, не голый import: сторож смерти уже заплатил расписку
// EXP за путаницу require/import ровно на этой паре библиотек.
const require = createRequire(import.meta.url);

const PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
const PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION = 0x4;
const ProcessPowerThrottling = 4;   // PROCESS_INFORMATION_CLASS

/**
 * Явный отказ от гашения разрешения. `ControlMask` — «этой политикой управляю я сам»,
 * `StateMask = 0` — «и выключаю её». Зовётся ДО `timeBeginPeriod`, потому что чинит судьбу
 * именно того запроса.
 *
 * @returns {boolean} принято ли ядром
 */
export function refuseTimerThrottling() {
  const koffi = require('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const PPTS = koffi.struct('PROCESS_POWER_THROTTLING_STATE', {
    Version: 'uint32_t', ControlMask: 'uint32_t', StateMask: 'uint32_t',
  });
  const getCurrentProcess = kernel32.func('void *GetCurrentProcess()');
  const setProcessInformation = kernel32.func(
    'bool SetProcessInformation(void *h, int cls, PROCESS_POWER_THROTTLING_STATE *info, uint32_t size)',
  );
  return setProcessInformation(getCurrentProcess(), ProcessPowerThrottling, {
    Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
    ControlMask: PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
    StateMask: 0,
  }, koffi.sizeof(PPTS));
}

/**
 * Единственная дверь к `timeBeginPeriod`/`timeEndPeriod` в проекте. Форма сохранена дословно —
 * `{ begin, end }`, — чтобы все семь прежних мест вызова заработали без правки, а лекарство
 * встало в каждое из них разом.
 */
export function loadWinmm() {
  // 🔴 `bugs/128`: без этой строки следующий `begin(1)` у фонового процесса будет принят и
  // проигнорирован. Отказ дешёвый и безвредный: на переднем плане он ничего не меняет.
  refuseTimerThrottling();
  const koffi = require('koffi');
  const winmm = koffi.load('winmm.dll');
  return {
    begin: winmm.func('uint32_t timeBeginPeriod(uint32_t)'),
    end: winmm.func('uint32_t timeEndPeriod(uint32_t)'),
  };
}

/**
 * Разрешение таймера СИСТЕМЫ, мс. ⚠️ ЧИТАТЬ ОГОВОРКУ В ШАПКЕ ФАЙЛА: эта величина НЕ является
 * свидетелем такта процесса — при погашенном разрешении она рапортует 0,5 мс, пока процесс спит
 * по 15,6. Годится для протокола, не годится для ворот.
 *
 * @returns {number|null} мс, либо null если вызов не удался
 */
export function systemTimerResolutionMs() {
  const koffi = require('koffi');
  const ntdll = koffi.load('ntdll.dll');
  const q = ntdll.func(
    'int32_t NtQueryTimerResolution(_Out_ uint32_t *Min, _Out_ uint32_t *Max, _Out_ uint32_t *Cur)',
  );
  const mn = [0], mx = [0], cur = [0];
  return q(mn, mx, cur) === 0 ? cur[0] / 10000 : null;
}
