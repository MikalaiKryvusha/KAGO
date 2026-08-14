# Plan 10 — [WEAK-EXECUTOR] Shell improvements: KAGO folder + own chip logo, tray menu, idempotent apply

> **Created:** 2026-08-14 (owner's drive-by improvements, verbatim in `GOAL.md` →
> «Импрувменты оболочки (2026-08-14)»; sliced for a weak executor when the strong session ran out)
> **Parent:** `GOAL.md` improvements section; extends the closed phase-3 shell (`plans/06`, DONE)
> **Status:** 🟢 open — §4.0–§4.1 DONE by the strong session, **logo ACCEPTED by the owner
> 2026-08-14 ~17:1x, verbatim: «Суппер!»** (the path, each step his word: pick C «Лед и пламя…
> строгий графитовый чип» → «иконки снежинки и пламени как в емодзиках делают» → diagonal +
> «легкую едва ощутимую черту серую… из фейда появляется и в фейд уходит» → «снежинку и огонек…
> больше по размерам» — applied, re-shown, accepted). Final assets built: `kago-logo.png` (512),
> `kago-folder.ico` (**frames 256+128 only** — his «ниже 128 не делаем»). **Weak executor enters
> at §4.2; the ONE open input is Q1.** No redrawing/recomposing by a weak session, ever —
> re-running `assets/logo/README.md` commands is the ceiling
> **Outbound:** the logo pick + Q1 (tray face policy) → owner's word in chat, quoted into this
> plan · picked logo → GitHub README (both language copies)

**Executor profile:** weak model, strict step-following, coding allowed ONLY inside the contracts
below. Zero GPU writes anywhere in this plan — if a step seems to need one, STOP. Report to the
owner in Russian.

## §0 Owner input needed (ask ONCE, in chat, before §4.1; do not invent — three doors)

- **PICK:** which logo variant — A «Аврора» · B «Ядро» · C «Лёд и пламя» · D «Изумрудный контур»
  (or «поправь X»). Show `homeworks/02_logo_render.html` (open via `explorer.exe <path>` — the
  shell is elevated, EXP in STATUS «Состояние машины»).
- **Q1:** в трее логотип КУДА: (а) значок трея ВСЕГДА логотип KAGO (режим виден в подсказке и
  галочкой в меню) или (б) лица режимов остаются, логотип — только папка + GitHub? The owner said
  «пойдет … и в трей» — but the tray today shows the ACTIVE MODE's face; which one he means is his
  call, not ours.

## §1 Goal vector

The owner named three usability gaps in the shipped shell, then upgraded the icon ask to a brand
decision (his words, verbatim, in `GOAL.md`):

1. **Achieve:** the four mode shortcuts live in a Desktop FOLDER named `KAGO`; its icon is KAGO's
   OWN rendered chip logo (unique artwork, drawn in this repo — no downloaded icons). The same
   logo is the project logo: GitHub README, the Desktop folder, and the tray (per Q1).
2. **Achieve:** the tray icon carries a right-click menu — switch mode (same path as the
   shortcut: the elevated `\KAGO\apply-<mode>` task) and a «close the tray» item. Closing the
   tray REMOVES it from autostart; any mode apply puts it BACK into autostart and raises it.
   (Supersedes the 2026-08-09 «passive tray, no menu» decision — owner's word, `GOAL.md`.)
3. **Achieve:** re-launching the mode that is already on the card writes NOTHING to the GPU —
   it only re-enables the tray autostart (and raises the tray).

**Reading of «уже включен» (stated to the owner, unobjected):** judged against the CARD, not the
memory — remembered profile must match AND the card must already hold every value the profile
names. After a reboot the card is factory by physics, so a remembered non-factory mode is NOT
«already on» and applies normally.

## §2 Acceptance criteria

| # | Criterion | Meter · Target |
|---|---|---|
| AC1 | Desktop root has none of OUR four mode `.lnk`; `Desktop\KAGO\` has all four; folder shows the picked logo | `Get-ChildItem` both places + owner's eye · 0 stray / 4 inside |
| AC2 | Tray right-click menu: 4 modes + close; mode click == shortcut click | remembered state + tray face flip within one 2 s tick (tray.log) for a non-draft mode |
| AC3 | Close item: clean tray exit AND `\KAGO\tray` DISABLED | pid file gone, `exit clean` in tray.log, task read back `Enabled: False` |
| AC4 | Any `--apply`/`--reset` re-enables `\KAGO\tray` and starts it | task read back Enabled + live pid |
| AC5 | Re-apply of the active mode: zero write commands, exit 0, AC4 still runs | applier transcript: no write-step lines, says «уже активен» |
| AC6 | Offline proofs green, new blocks mutation-proved (targets named BEFORE the run, EXP-0016) | `npm run check` · selftests listed in §5 |
| AC7 | Picked logo in GitHub README header, both language copies | README diff + rendered check |

## §3 Evidence base (read, not re-derived)

- `researches/07` — tray: NotifyIcon needs the message loop; menu = `ContextMenuStrip` on the
  same STA thread; the tray is UNELEVATED (Limited) and must stay so.
- Shortcut path (`setup-desktop.mjs`): `.lnk` → `schtasks /run /tn "\KAGO\apply-<mode>"`;
  starting a task never elevates the starter — the task runs as its registered principal. The
  menu reuses exactly this; NO free-form commands ride the menu (researches/03 §3.6 invariant).
- Icon pipeline (assets/icons/README.md): `magick <png> -define icon:auto-resize=256,64,48,32,24,16 <out>.ico`.
  SVG→PNG: `magick <svg> -resize 256x256 <png>` (rsvg delegate proven on these files; 8-digit hex
  colors render WRONG — use `stroke-opacity`, already applied).
- EXP-0043: `schtasks`/slash-flag CLIs from PowerShell or spawnSync argv — NEVER from bash.
- EXP-0045: a taste choice is the owner's; never record his verdict for him.
- Dossier row: `Set-Content` writes cp1251/BOM traps — JSON and code are written with file tools
  or Node, never with `Set-Content`. `tray.ps1` MUST keep its UTF-8 BOM (selftest block 1).

## §4 Steps

### 4.0 Logo candidates — ✅ DONE by the strong session 2026-08-14

Four unique SVGs drawn and rendered: `assets/logo/candidates/{a_aurora,b_core,c_ice_flame,d_emerald}.svg`
(+ PNG 256/48/16 beside them, + `montage.png`), comparison page `homeworks/02_logo_render.html`.
Visual check done: all four legible at 48 and 16 px. SVG tweaks after the owner's feedback are
STRONG-model work — a weak executor only re-runs the render commands above, never redraws paths.

### 4.1 The pick → final logo assets (owner's pick MADE and composed; Q1 still open)

The logo IS BUILT by the strong session: `assets/logo/kago-logo.png` (512 px) = own graphite
chip (`chip-base.svg`) + Fluent Emoji 3D snowflake & fire composited (`assets/logo/README.md`
has the exact commands and the owner's verbatim words). **Owner's icon-quality rule, verbatim:
«ниже 128 не делаем» — ICO frames are 256 and 128 ONLY.** Remaining mechanics:

1. After the owner's «да» on the composed logo:
   `magick assets/logo/kago-logo.png -define icon:auto-resize=256,128 assets/logo/kago-folder.ico`
   Expect: `magick identify` lists exactly 2 frames (256, 128).
2. Quote the Q1 answer into this plan's Status line; if Q1 = «логотип в трее» — §4.5 additionally
   sets the NotifyIcon icon from `kago-folder.ico` (Resolve-FaceIcon already degrades gracefully;
   the mode faces then live only in the menu checkmarks and the tooltip).
Weak session NEVER redraws or recomposes — re-running the documented commands is the ceiling.

### 4.2 Desktop folder in `setup-desktop.mjs`

Contract (edit `cmdInstall`/`cmdUninstall`/`cmdStatus`/`buildReceipt`):

- New constants: `DESKTOP_FOLDER_NAME = 'KAGO'`, folder path = `path.join(desktopDir(), 'KAGO')`;
  logo ico = `assets/logo/kago-folder.ico` (absolute, from `REPO_ROOT`).
- `cmdInstall`: create the folder BEFORE shortcuts; write `desktop.ini` inside it with content
  `[.ShellClass Info]` — NO. Exact content (write with Node `writeFileSync`, encoding `utf8`,
  CRLF):

  ```
  [.ShellClassInfo]
  IconResource=<abs path to kago-folder.ico>,0
  InfoTip=KAGO — режимы GPU
  ```

  Then set attributes (PowerShell): `attrib +h +s <folder>\desktop.ini` and `attrib +r <folder>`.
  Shortcuts are created INSIDE the folder (change `lnkPath`). Migration: for each of OUR four
  titles (read from `profiles/*.json` — never a hard-coded list), if `<Desktop>\<title>.lnk`
  exists at the root, `Remove-Item -LiteralPath` it AFTER the folder copy is verified. **STOP-line:
  the ONLY Desktop-root files this plan may touch are those four exact `.lnk` names — anything
  else on the Desktop is the owner's and is not read, not moved, not listed in the report.**
- `buildReceipt`: add artifacts (folder + desktop.ini) BEFORE creation with delete commands
  (`Remove-Item -Recurse -Force -LiteralPath "<Desktop>\KAGO"` — the receipt names the exact
  path, and delete of the FOLDER covers the ini and the `.lnk` inside).
- `cmdUninstall`: stop tray → delete tasks (unchanged) → remove the folder per receipt.
- `cmdStatus`: report folder exists / ini present / how many of the 4 `.lnk` inside.
Expect after live `--install`: AC1 numbers; `--status` shows the folder row.

### 4.3 Idempotent apply in `profile-manager.mjs` (CLI layer ONLY — never inside `apply()`)

Before calling `apply()` in the `--apply` branch:

```js
const { state: remembered } = readRememberedState();
const live = readState(backend);
const target = resolveTarget(profile, live);
const alreadyOn = remembered?.profile === profile.name
  && Math.abs(live.powerLimitW - target.powerLimitW) < WATT_EPSILON
  && !target.lock;   // a lock is NOT observable at idle (EXP-0014) — never judged «already on»
```

If `alreadyOn`: print `РЕЖИМ УЖЕ АКТИВЕН — записей в карту ноль` + the live numbers, do NOT call
`apply()`, do NOT rewrite the remembered state (same content, but the tray watches the mtime —
a no-op must not flap it), fall through to the §4.4 helper call, exit 0.
Same shape in `--reset`: remembered `factory` AND `live.powerLimitW == live.powerDefaultW`
(within epsilon) → no-op path. (Clock: factory profile has no lock → the `!target.lock` guard
covers it; do not invent extra clock checks.)
Draft profiles: the qualification gate in `apply()` still refuses — the no-op check runs BEFORE
`apply()` but a draft can never BE the remembered state (only verified applies write it), so the
no-op path cannot mask the gate. State this in a comment.

### 4.4 Tray autostart helper — new `automation-engine/lib/tray-autostart.mjs`

Exports (all drive `schtasks.exe` via `spawnSync` with argv arrays, full path
`C:\Windows\System32\schtasks.exe`):

- `ensureTrayAutostart()` → `/Change /TN "\KAGO\tray" /ENABLE`, then `/Run /TN "\KAGO\tray"`,
  then read back via `/Query /TN "\KAGO\tray" /FO LIST` — parse the `Status`/`Scheduled Task
  State` line; return `{ ok, detail }`. Task missing → `{ ok: false, detail: 'задача не
  зарегистрирована — npm run setup -- --install' }`, NEVER a throw.
- `disableTrayAutostart()` → `/Change … /DISABLE` + the same read-back.
Called at the END of `--apply` and `--reset` (both applied and no-op paths) in the CLI; one
printed line either way. `--boot-apply` does NOT call it (logon already starts the tray task).

### 4.5 Tray menu in `tray.ps1`

- Build titles map at startup: for each of the four mode ids, read `profiles/<id>.json` title
  (`[System.IO.File]::ReadAllText` + `ConvertFrom-Json`; on any problem degrade to the id).
- `ContextMenuStrip`: 4 mode items + separator + item «Закрыть значок KAGO».
  - Mode click: `Start-Process -WindowStyle Hidden schtasks.exe -ArgumentList '/Run','/TN',"\KAGO\apply-<id>"`.
  - Menu `Opening` handler: checkmark the item whose id equals the CURRENT state file profile.
  - Close click: run `schtasks /Change /TN "\KAGO\tray" /DISABLE` (Limited process owns the
    task — expected to work; **if it errors live, do NOT escalate elevation**: fall back per
    plan risk (b) — write sentinel `runs/shell/tray.disabled`, and `tray-launcher.js` exits
    early when the sentinel exists; `ensureTrayAutostart()` then also deletes the sentinel).
    Then `$appContext.ExitThread()` (clean exit → `finally` removes pid).
- `$notify.ContextMenuStrip = $menu` — same STA thread, no second loop.
- **The BOM stays. Selftest additions** (pure functions only, sandboxed): menu model maps 4 ids
  → 4 task names `\KAGO\apply-<id>`; titles degrade to id on broken json; active-mode detection
  picks the right item for a given state file; close-action model returns the exact schtasks
  argv. Name each block in Russian like the existing eleven.
Expect: `-SelfTest` = 15 blocks green.

### 4.6 Proofs, live install, canon

1. Offline: `npm run check` (31 files, 0 failed — count may grow) · `node automation-engine/lib/profile-manager.mjs --selftest`
   · `powershell -File automation-engine/tray.ps1 -SelfTest` · desktop-shortcuts selftest.
2. Mutations (write your own one-shot script, name the target block BEFORE running, delete after):
   (м1) invert `alreadyOn` → the idempotency block reddens; (м2) break the menu id→task map →
   its block reddens; (м3) drop the disable read-back → its block reddens. Each mutation reverted
   before the next.
3. Live (the grant covers `npm run setup*`): `npm run setup -- --install`, then walk AC1–AC5 in
   order, quoting each observation (numbers, tray.log lines, task read-backs) in the report.
   AC5 live path: `--apply test-pl250` twice in a row (test profile, ±0 risk, already proven on
   this card) — first applies, second must no-op; then `--reset`.
4. AC7: README header logo (image at top, both RU/EN copies — storefront rules, draw on the
   current README's own handwriting).
5. Canon: STATUS (session block + «Решено владельцем» tray line), internal map §4 (tray anatomy
   + folder), `GOAL.md` untouched (already carries the words). Commit per git hygiene
   (`git diff --stat` first; test-file changes carry the justification block).

## §5 Risks

- (a) `desktop.ini` icon caching: explorer may lag; verify by re-reading attrs + ini, let the
  owner's eye confirm; an explorer restart is NOT taken by the agent.
- (b) Limited tray can't disable its own task → sentinel fallback wired in §4.5, named here so
  it is a plan, not an improvisation.
- (c) Owner's Desktop is his workspace — the STOP-line in §4.2 is absolute.
- (d) The menu never elevates and never carries free-form commands — pre-registered tasks only.
- (e) A weak session that gets stuck (3 failed fix loops) STOPS and files the state honestly
  (`BUG_FIXING_FRAMEWORK.md`) instead of improvising around the contract.
