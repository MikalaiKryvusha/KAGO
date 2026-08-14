# automation-engine/tray.ps1 — THE PASSIVE TRAY (phase 3 §4.5, plans/06). PowerShell 5.1 +
# System.Windows.Forms.NotifyIcon per the researches/07 verdict. Started HIDDEN by tray-launcher.js
# (wscript) from the \KAGO\tray logon task, which runs UNELEVATED — the tray reads one JSON file
# and must never hold elevation (researches/07 §2).
#
# THE WHOLE CONTRACT (plan §4.5): display the ORCHESTRATOR's remembered state
# (runs/shell/remembered-state.json — the last VERIFIED apply), refresh when the file changes,
# and nothing else. No card polling, no telemetry, no menu, no buttons, no click actions. The
# process owns no GPU handles and arms nothing: killing it changes nothing on the card (P3-AC4).
#
# ENCODING IS LOAD-BEARING: this file is UTF-8 WITH BOM. PowerShell 5.1 reads a BOM-less file as
# ANSI (cp1251 on this machine — the dossier row), which would mojibake every Russian tooltip
# below. Self-test block 1 guards the BOM; if it reddens after an edit, re-add the BOM.
#
# [TESTED: 2026-08-14 11:5x · -SelfTest: 11 blocks green; 4 mutations reddened their named blocks
#  (BOM strip = loud parse failure, exit 1 · ico-loader nulled = block 10 alone) · live: icon
#  appears from the \KAGO\tray task, tracks apply-test-pl250 → apply-factory within one 2 s tick
#  (tray.log), kill → gpu:info --json shows 0 settable diffs of 29 fields (P3-AC4; only the idle
#  clock breathed), second start exits on the mutex, 🔄 face loads from the shipped .ico after the
#  11:5x restart. Deferred, display-only: explorer-restart re-add · no-flash at a real logon.]

param(
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

# The script sits in automation-engine/; the repo root is one level up. Paths are derived, not
# hard-coded (EXP-0025) — and the selftest passes its own sandbox paths to every function.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $RepoRoot 'runs\shell\remembered-state.json'
$PidFile = Join-Path $RepoRoot 'runs\shell\tray.pid'
$LogFile = Join-Path $RepoRoot 'runs\shell\tray.log'

Add-Type -AssemblyName System.Drawing

# ================================================================================================
# Faces — one per profile id the remembered state can carry, plus the two honest fallbacks.
# Color + glyph is the icon; the tooltip carries the owner's own title from the state file.
# ================================================================================================

# Interview 005 (closed 2026-08-14 12:2x, the owner's word AFTER seeing the 2-vs-4 render):
# the set is Fluent Emoji 3D, tray wears the same .ico as the desktop; the Stock Default face is
# the counterclockwise arrows («возврат») — and since 2026-08-14 evening the mode's own emoji is
# 🔄, not ⏹: the owner's word «остался квадрат, который мне не нравился … я говорил, что хочу тот
# синий с двумя стрелочками» — the icon was right, the LABEL still carried the square.
# Swapping the set = swapping files in assets/icons/, no code.
# The drawn color+glyph stays as the FALLBACK when an asset is missing — the tray degrades, it
# never dies over an icon file. The three service faces (test / unknown / problem) stay drawn:
# the icon set has no such concepts, and inventing them is worse.
$IconsDir = Join-Path $RepoRoot 'assets\icons\fluent-3d'
$FACES = @{
  'max-performance' = @{ color = 'OrangeRed';    glyph = 'M'; ico = (Join-Path $IconsDir 'max-performance.ico') }
  'optimised'       = @{ color = 'SeaGreen';     glyph = 'O'; ico = (Join-Path $IconsDir 'optimised.ico') }
  'silent-cold'     = @{ color = 'DeepSkyBlue';  glyph = 'C'; ico = (Join-Path $IconsDir 'silent-cold.ico') }
  'factory'         = @{ color = 'Gray';         glyph = 'STOP'; ico = (Join-Path $IconsDir 'stock-default.ico') }
  'test-pl250'      = @{ color = 'MediumPurple'; glyph = 'T' }
  'unknown'         = @{ color = 'DimGray';      glyph = '?' }      # a profile id this tray has no face for
  'problem'         = @{ color = 'Goldenrod';    glyph = '!' }      # the state file exists and cannot be trusted
}

# Load a face from a shipped .ico (best frame for 32 px). $null on ANY problem — the caller falls
# back to the drawn face; a missing asset costs looks, never the tray.
function Get-IcoIcon([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $null }
  try { return New-Object System.Drawing.Icon($path, 32, 32) } catch { return $null }
}

# One face → one Icon object: the shipped .ico when the face names one and it loads, else drawn.
function Resolve-FaceIcon($face) {
  $fromFile = Get-IcoIcon $face.ico
  if ($fromFile) { return $fromFile }
  return New-TrayIcon $face.color $face.glyph
}

# NotifyIcon.Text throws above 63 UTF-16 units on .NET Framework — truncate, never crash the tray
# over a long title. The cut backs off a lone high surrogate so an emoji is dropped whole.
function Limit-Tooltip([string]$text) {
  if ($text.Length -le 63) { return $text }
  $cut = 60
  if ([char]::IsHighSurrogate($text[$cut - 1])) { $cut = $cut - 1 }
  return $text.Substring(0, $cut) + '…'
}

# Mirrors remembered-state.mjs readRememberedState(): three honest answers, never a throw.
function Read-TrayState([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{ state = $null; problem = $null } }
  try { $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) }
  catch { return @{ state = $null; problem = "file unreadable: $($_.Exception.Message)" } }
  try { $parsed = $raw | ConvertFrom-Json }
  catch { return @{ state = $null; problem = 'file is not JSON' } }
  if (-not ($parsed.profile -is [string]) -or -not $parsed.profile) {
    return @{ state = $null; problem = 'no profile field' }
  }
  return @{ state = @{ profile = $parsed.profile; title = $parsed.title }; problem = $null }
}

# The applier's writeFileSync is not atomic: one tick can catch a half-written file. One short
# retry turns that transient into a non-event instead of a flapping «problem» face.
function Read-TrayStateStable([string]$path) {
  $r = Read-TrayState $path
  if ($r.problem -and (Test-Path -LiteralPath $path)) {
    Start-Sleep -Milliseconds 200
    $r = Read-TrayState $path
  }
  return $r
}

# read result → which face to show and what the tooltip says. No file = nothing was ever
# remembered = the card is factory BY PHYSICS (volatile GPU state) — the factory face is truthful,
# and the tooltip names the nuance.
function Get-TrayFace($read) {
  if ($read.problem) {
    return @{ key = 'problem'; tooltip = (Limit-Tooltip 'KAGO: файл состояния нечитаем — см. tray.log') }
  }
  if ($null -eq $read.state) {
    return @{ key = 'factory'; tooltip = (Limit-Tooltip 'KAGO: ничего не запомнено — карта заводская') }
  }
  $key = if ($FACES.ContainsKey($read.state.profile)) { $read.state.profile } else { 'unknown' }
  $label = if ($read.state.title) { $read.state.title } else { $read.state.profile }
  return @{ key = $key; tooltip = (Limit-Tooltip "KAGO: $label") }
}

# 32×32 colored disc + white glyph. Icons are built ONCE per face and held for the process life —
# GetHicon handles leak if churned, so the cache is the hygiene, not an optimization.
function New-TrayIcon([string]$colorName, [string]$glyph) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($colorName))
    $g.FillEllipse($brush, 1, 1, 30, 30)
    $brush.Dispose()
    if ($glyph -eq 'STOP') {
      $g.FillRectangle([System.Drawing.Brushes]::White, 10, 10, 12, 12)
    } else {
      $font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $fmt = New-Object System.Drawing.StringFormat
      $fmt.Alignment = [System.Drawing.StringAlignment]::Center
      $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
      $g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 32, 32), $fmt)
      $font.Dispose(); $fmt.Dispose()
    }
  } finally { $g.Dispose() }
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

function Write-TrayLog([string]$file, [string]$line) {
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'
  [System.IO.File]::AppendAllText($file, "$stamp $line`r`n", (New-Object System.Text.UTF8Encoding $false))
}

# ================================================================================================
# Self-test — the logic without the message loop, in a sandbox. No NotifyIcon, no mutex, no GPU.
# ================================================================================================

function Invoke-SelfTest {
  $blocks = @()
  $sandbox = Join-Path $env:TEMP ("kago-tray-selftest-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $sandbox | Out-Null
  $utf8 = New-Object System.Text.UTF8Encoding $false
  try {
    # 1 — the encoding guard: this very file must open with the UTF-8 BOM, or every Russian
    # string above is already mojibake on PS 5.1 (the block exists because an edit can drop it).
    $bytes = [System.IO.File]::ReadAllBytes($PSCommandPath)
    $ok = ($bytes.Length -gt 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $blocks += @{ name = 'BOM на месте: файл скрипта начинается с EF BB BF'; ok = $ok }

    # 2 — a valid state file yields profile + title
    $valid = Join-Path $sandbox 'valid.json'
    [System.IO.File]::WriteAllText($valid, '{"profile":"test-pl250","title":"🔧 Тестовый профиль −50 Вт (НЕ режим)"}', $utf8)
    $r = Read-TrayState $valid
    $ok = ($null -eq $r.problem -and $r.state.profile -eq 'test-pl250' -and $r.state.title -like '*Тестовый*')
    $blocks += @{ name = 'валидное состояние читается: profile и title извлечены'; ok = $ok }

    # 3 — no file → the factory face, tooltip says the card is factory by physics
    $face = Get-TrayFace (Read-TrayState (Join-Path $sandbox 'absent.json'))
    $ok = ($face.key -eq 'factory' -and $face.tooltip -like '*заводская*')
    $blocks += @{ name = 'нет файла — лицо factory, подпись про заводскую карту'; ok = $ok }

    # 4 — broken JSON → the problem face, loudly, even after the one retry
    $broken = Join-Path $sandbox 'broken.json'
    [System.IO.File]::WriteAllText($broken, '{"profile": "max-per', $utf8)
    $face = Get-TrayFace (Read-TrayStateStable $broken)
    $ok = ($face.key -eq 'problem' -and $face.tooltip -like '*нечитаем*')
    $blocks += @{ name = 'битый JSON — лицо problem, подпись про нечитаемость'; ok = $ok }

    # 5 — JSON without a profile field → the problem face (a record that lost its meaning)
    $noProfile = Join-Path $sandbox 'no-profile.json'
    [System.IO.File]::WriteAllText($noProfile, '{"title":"что-то"}', $utf8)
    $face = Get-TrayFace (Read-TrayState $noProfile)
    $ok = ($face.key -eq 'problem')
    $blocks += @{ name = 'нет поля profile — лицо problem'; ok = $ok }

    # 6 — an unknown profile id → the unknown face, but the tooltip still shows the title
    $unknown = Join-Path $sandbox 'unknown.json'
    [System.IO.File]::WriteAllText($unknown, '{"profile":"mystery-mode","title":"Новый режим"}', $utf8)
    $face = Get-TrayFace (Read-TrayState $unknown)
    $ok = ($face.key -eq 'unknown' -and $face.tooltip -eq 'KAGO: Новый режим')
    $blocks += @{ name = 'неизвестный profile — лицо unknown, подпись несёт title'; ok = $ok }

    # 7 — a hostile long title is truncated below NotifyIcon's 63-unit ceiling instead of throwing
    $long = Join-Path $sandbox 'long.json'
    [System.IO.File]::WriteAllText($long, ('{"profile":"factory","title":"' + ('Д' * 100) + '"}'), $utf8)
    $face = Get-TrayFace (Read-TrayState $long)
    $ok = ($face.tooltip.Length -le 63)
    $blocks += @{ name = 'длинная подпись усечена до 63'; ok = $ok }

    # 8 — every face builds a real icon (GDI+ works headless; this is what the tray will hold)
    $built = 0
    foreach ($k in $FACES.Keys) {
      $ico = New-TrayIcon $FACES[$k].color $FACES[$k].glyph
      if ($ico -is [System.Drawing.Icon]) { $built++ }
    }
    $ok = ($built -eq $FACES.Count)
    $blocks += @{ name = "иконки строятся для всех лиц ($built из $($FACES.Count))"; ok = $ok }

    # 9 — pid file round-trip (what --status and the P3-AC4 kill test read)
    $pidPath = Join-Path $sandbox 'tray.pid'
    [System.IO.File]::WriteAllText($pidPath, "$PID", $utf8)
    $readBack = [System.IO.File]::ReadAllText($pidPath).Trim()
    Remove-Item -LiteralPath $pidPath
    $ok = ($readBack -eq "$PID" -and -not (Test-Path -LiteralPath $pidPath))
    $blocks += @{ name = 'pid-файл: записан и удалён'; ok = $ok }

    # 10 — the owner's verdict: ALL FOUR mode faces load from the SHIPPED .ico set (tray = desktop)
    $loaded = 0
    foreach ($k in @('max-performance', 'optimised', 'silent-cold', 'factory')) {
      if ((Get-IcoIcon $FACES[$k].ico) -is [System.Drawing.Icon]) { $loaded++ }
    }
    $ok = ($loaded -eq 4)
    $blocks += @{ name = "лица четырёх режимов грузятся из поставленных .ico ($loaded из 4, вердикт 005)"; ok = $ok }

    # 11 — a missing .ico degrades to the drawn face instead of killing the tray
    $fallback = Resolve-FaceIcon @{ color = 'Gray'; glyph = 'STOP'; ico = (Join-Path $sandbox 'no-such.ico') }
    $ok = ($fallback -is [System.Drawing.Icon])
    $blocks += @{ name = 'нет .ico — откат на рисованное лицо, трей жив'; ok = $ok }
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $sandbox -ErrorAction SilentlyContinue
  }

  $fails = 0
  foreach ($b in $blocks) {
    if ($b.ok) { Write-Output "OK     блок — $($b.name)" }
    else { $fails++; Write-Output "ПРОВАЛ блок — $($b.name)" }
  }
  Write-Output "ИТОГ: $($blocks.Count - $fails) из $($blocks.Count) блоков зелёные."
  if ($fails -gt 0) { exit 1 } else { exit 0 }
}

if ($SelfTest) {
  # The console may be cp866/cp1251; force UTF-8 so the Russian block names survive the pipe.
  try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
  Invoke-SelfTest
  return
}

# ================================================================================================
# The tray itself — single instance, pid file, NotifyIcon, a 2 s file-stamp timer, message loop.
# ================================================================================================

Add-Type -AssemblyName System.Windows.Forms

# One tray per machine: the second instance exits silently (the logon task can be re-run freely).
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'KAGO.Tray', [ref]$created)
if (-not $created) {
  Write-TrayLog $LogFile "second instance (pid=$PID) — mutex held, exiting"
  exit 0
}

# The log is a diagnostic, not history — cap it instead of letting it grow for years.
if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 512KB) {
  Remove-Item -LiteralPath $LogFile
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PidFile) | Out-Null
[System.IO.File]::WriteAllText($PidFile, "$PID", (New-Object System.Text.UTF8Encoding $false))
Write-TrayLog $LogFile "start pid=$PID state=$StateFile"

function Get-FileStamp([string]$path) {
  if (Test-Path -LiteralPath $path) { return [string](Get-Item -LiteralPath $path).LastWriteTimeUtc.Ticks }
  return 'absent'
}

$script:icons = @{}
foreach ($k in $FACES.Keys) { $script:icons[$k] = Resolve-FaceIcon $FACES[$k] }

$notify = New-Object System.Windows.Forms.NotifyIcon
$script:shownKey = $null
$script:shownText = $null
$script:lastStamp = $null

function Update-Tray {
  $stamp = Get-FileStamp $StateFile
  if ($stamp -eq $script:lastStamp) { return }
  $script:lastStamp = $stamp
  $face = Get-TrayFace (Read-TrayStateStable $StateFile)
  if ($face.key -eq $script:shownKey -and $face.tooltip -eq $script:shownText) { return }
  $notify.Icon = $script:icons[$face.key]
  $notify.Text = $face.tooltip
  $script:shownKey = $face.key
  $script:shownText = $face.tooltip
  Write-TrayLog $LogFile "state -> $($face.key) [$($face.tooltip)]"
}

try {
  Update-Tray
  $notify.Visible = $true
  Write-TrayLog $LogFile "icon visible, face=$($script:shownKey)"

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 2000
  $timer.Add_Tick({ try { Update-Tray } catch { Write-TrayLog $LogFile "tick error: $($_.Exception.Message)" } })
  $timer.Start()

  # The message loop NotifyIcon requires (researches/07 §2 — there is no loop-free tray icon).
  # TaskbarCreated re-add on explorer restart comes from the framework (§3, candidate A).
  [System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
} finally {
  # A hard kill never runs this — that is fine and PROVEN fine (P3-AC4): the icon ghosts until
  # hover, the pid file goes stale (readers must check the process), the card is untouched.
  $notify.Visible = $false
  $notify.Dispose()
  Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
  # The mutex is HELD for the process life — that is its use; dispose only on this clean path.
  $mutex.Dispose()
  Write-TrayLog $LogFile "exit clean pid=$PID"
}
