# Bug 143 — the Stop-hook `tidy` went blind when Windows dropped `wmic`, read the blindness as «nothing runs» and closed the owner's question page

**Status:** ✅ DONE 2026-09-26 16:2x (session 105) — fixed in code and witnessed on the real path: the second page of
`interview_032` stayed open across several of my turns (`node tools/tidy.mjs` printed «ПРОГОН В РАБОТЕ — НЕ ТРОГАЮ НИЧЕГО (контур
согласований ждёт владельца: pid 26264)»), the owner saved Q1 alone at 16:20 and Q2 later, and the page ended itself with exit 0
**Severity:** S1 for what it guards, S2 for what it cost: the owner's page closed under him («закралась сама страница, я не успел
почитать», chat 2026-09-26 16:17); the same blindness disarmed the `bugs/21` protection of live card runs (the observation-window
server and its window are killed when `runInFlight` sees nothing) — no card run happened while it was blind, as far as the record shows
**Version/build:** HEAD `0e00669` · **When/context:** the first live page of the KAIF 2.8 contour (`plans/104` Ш7), 2026-09-26 16:16

## Symptom

The page of `interview_032` came up at 16:16:28 (`interviews/decisions/shown.json`), called the owner, and closed at 16:16:44 —
`Outcome: page closed without an answer — ending the contour (I14, beacon fast path)`, exit 2 — seconds after my turn ended, i.e. when
the `Stop` hook runs `node tools/tidy.mjs --apply`.

## Root cause (observed, not guessed)

- `PowerShell: Get-Command wmic` → not found; `wmic process …` → «The term 'wmic' is not recognized» — Windows 11 Pro 26200 no longer
  ships it.
- `tools/tidy.mjs` listed processes ONLY through `wmic` (`processesNamed`, `childCount`), and its `run()` swallows a failure into an
  empty string — so every list came back EMPTY, and `runInFlight([])` answered «not busy».
- Past the busy gate, `dash.closeWindow()` closes every Edge/Chrome window whose title holds «KAGO» — the owner's page among them.
  `bugs/64`'s fix (a live contour makes the machine busy) was intact in the code and dead in effect: it never saw a process.

## Fix

- `listProcesses(filter)` — `Get-CimInstance Win32_Process` through PowerShell (hidden window, UTF-8 output, JSON), and a FAILURE to
  get the list returns `null` — blindness, not emptiness; `runInFlight(null)` → busy «список процессов не получен»; `childCount` → `null`.
- The fix surfaced a second, latent hole: with the list working, the inspection named `OpenConsole.exe --headless` (pid 40056, the
  pseudo-console host of a VS Code integrated terminal, parent `Code.exe`) «БРОШЕНО, закрываю» — its shell does not hang on it, so «0
  processes inside» means nothing. `isAbandonedTerminal(cmd, kids)`: a `--headless` host and an unseen (`null`) count are never
  abandoned. Found BEFORE the Stop hook ran with the new list.

## Guards (each seen red)

- `tidy --selftest`: «bugs/143: список процессов НЕ ПОЛУЧЕН (null) — … занятой» · «терминал: хост IDE (OpenConsole --headless) … НЕ
  брошен …». 21 blocks, 0 red. Mutants: the `null` check removed → the first block red (1 of 21); the `--headless` check removed → the
  second block red (1 of 21).
- Real path: page 2 of `interview_032` up at port 60974 → `node tools/tidy.mjs` (inspection) → «ПРОГОН В РАБОТЕ — НЕ ТРОГАЮ
  НИЧЕГО (контур согласований ждёт владельца: pid 26264)»; the page survived the end of my turn; Q1 recorded 16:20.

## Twins

`grep -rln wmic --include=*.mjs automation-engine tools` → `tools/tidy.mjs` only. Other Windows CLIs the project relies on
(`tasklist`, `taskkill`, `schtasks`, `nvidia-smi`) are present; not probed one by one here.

**Lesson:** EXP-0300.
