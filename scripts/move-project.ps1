# move-project.ps1 — one project folder (owner's plan, 2026-11-10). Started by the Desktop click-file «نقل المشروع»,
# which copies this script to %TEMP% and runs it from there (nothing may run from inside the folders being moved).
#
#   Desktop\alsuhaiby-site               -> Desktop\alsuhaiby\alsuhaiby-site      (PUBLIC repo, own .git)
#   Desktop\alsuhaiby-library            -> Desktop\alsuhaiby\alsuhaiby-library   (PRIVATE repo, own .git, side by side)
#   Videos\alsuhaiby-downloads           -> Desktop\alsuhaiby\media\downloads
#   Videos\ChatExport_2026-10-30         -> Desktop\alsuhaiby\media\telegram-export
#   + the 5 Desktop shortcuts (target, arguments, working folder, icon) and Claude Code's memory folder.
#
# Stage 0  preflight: refuses to start if a project process runs (night / numbers / comments / download / meters) or
#          anything is out of place. Changes nothing.
# Stage 1  move: every action records its undo; if ANY action fails, everything done so far is undone (never half-moved).
# Stage 2  verify: every shortcut target / folder / icon exists, key files are there, the site code finds the library
#          and videos. Any FAIL -> the whole move is undone.
# Stage 3  only after a PASS: 3 one-of-a-kind files -> archive\, approved items -> Recycle Bin (never a permanent delete;
#          each duplicate video is re-checked byte for byte against its copy first).
# -DryRun runs stage 0 and prints the plan. The other parameters exist only for the sandbox test.
param(
  [string]$Desktop = [Environment]::GetFolderPath('Desktop'),
  [string]$Videos = (Join-Path $env:USERPROFILE 'Videos'),
  [string]$Downloads = (Join-Path $env:USERPROFILE 'Downloads'),
  [string]$ClaudeProjects = (Join-Path $env:USERPROFILE '.claude\projects'),
  [switch]$DryRun,
  [switch]$NoPause,
  [string]$ClickFile = '',   # the Desktop click-file; sent to the Recycle Bin after a fully successful move
  [switch]$SandboxTest   # test only: removes sandbox files instead of using the Recycle Bin; refused outside the sandbox
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName Microsoft.VisualBasic
if ($SandboxTest -and $Desktop -notmatch 'alsuhaiby-move-sandbox') { Write-Host 'SandboxTest is only allowed inside the test sandbox.' -ForegroundColor Red; exit 3 }

$Parent  = Join-Path $Desktop 'alsuhaiby'
$OldSite = Join-Path $Desktop 'alsuhaiby-site'
$NewSite = Join-Path $Parent 'alsuhaiby-site'
$Moves = @(
  @{ Name = 'site repo';        From = $OldSite;                                    To = $NewSite },
  @{ Name = 'library repo';     From = (Join-Path $Desktop 'alsuhaiby-library');    To = (Join-Path $Parent 'alsuhaiby-library') },
  @{ Name = 'downloaded videos';From = (Join-Path $Videos 'alsuhaiby-downloads');   To = (Join-Path $Parent 'media\downloads') },
  @{ Name = 'telegram export';  From = (Join-Path $Videos 'ChatExport_2026-10-30'); To = (Join-Path $Parent 'media\telegram-export') }
)
$claudeKey = { param($p) ($p -replace '[^A-Za-z0-9]', '-') }
$OldMem = Join-Path $ClaudeProjects ((& $claudeKey $OldSite) + '\memory')
$NewMemDir = Join-Path $ClaudeProjects (& $claudeKey $NewSite)
$Log = New-Object System.Collections.Generic.List[string]
function Say($t, $color = 'Gray') { Write-Host $t -ForegroundColor $color; $Log.Add($t) }
function Pass($t) { Say "PASS  $t" 'Green' }
function Fail($t) { Say "FAIL  $t" 'Red' }
function Finish($code) {
  $logFile = if ($code -eq 0 -and (Test-Path -LiteralPath $Parent)) { Join-Path $Parent 'move-log.txt' } else { Join-Path $env:TEMP 'alsuhaiby-move-log.txt' }
  try { $Log | Set-Content -LiteralPath $logFile -Encoding UTF8; Write-Host "log: $logFile" } catch {}
  if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
  exit $code
}

# ---------------------------------------------------------------- stage 0: preflight (changes nothing)
Say '== Stage 0: preflight' 'Cyan'
$problems = @()
$pattern = '\\alsuhaiby-site\\|\\alsuhaiby-library\\|alsuhaiby-downloads|ChatExport_2026-10-30|night\.js|meta\.js|fetch\.js|meters\.pyw|watcher\.py|numbers\.bat|comments\.bat|fetch\.bat|night\.bat'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $pattern -and $_.CommandLine -notmatch 'move-project\.ps1|alsuhaiby-move\.ps1' }
foreach ($p in $procs) {
  $c = $p.CommandLine
  $what = if ($c -match 'meters\.pyw|watcher\.py') { 'the meters widget (close it: right-click on it -> close, or the «إيقاف المراقب» shortcut)' }
    elseif ($c -match 'night') { 'the night run (npm run night)' }
    elseif ($c -match 'part=numbers|numbers\.bat') { 'the numbers run («بيانات الصهيبي»)' }
    elseif ($c -match 'part=comments|comments\.bat') { 'the comments run («تعليقات الصهيبي»)' }
    elseif ($c -match 'fetch') { 'the download run («تنزيل الصهيبي»)' }
    else { "another program working inside the project: $($p.Name) (pid $($p.ProcessId))" }
  $problems += "still running: $what"
}
foreach ($m in $Moves) {
  if (-not (Test-Path -LiteralPath $m.From)) { $problems += "missing: $($m.From)" }
  if (Test-Path -LiteralPath $m.To) { $problems += "already exists: $($m.To)" }
  if ((Split-Path -Qualifier $m.From) -ne (Split-Path -Qualifier $Desktop)) { $problems += "not on the same drive: $($m.From)" }
}
$shell = New-Object -ComObject Shell.Application
$deskNs = $shell.Namespace($Desktop)
$links = @()
foreach ($it in $deskNs.Items()) {
  if (-not $it.IsLink) { continue }
  $l = $it.GetLink
  $icon = ''; $idx = $l.GetIconLocation([ref]$icon)
  if (($l.Path + ' ' + $l.Arguments + ' ' + $l.WorkingDirectory + ' ' + $icon) -like "*$OldSite*") {
    $links += [pscustomobject]@{ Name = $it.Name; File = $it.Path; Path = $l.Path; Args = $l.Arguments; Dir = $l.WorkingDirectory; Icon = $icon; IconIdx = $idx }
  }
}
if ($links.Count -ne 5) { $problems += "expected 5 project shortcuts on the Desktop, found $($links.Count)" }
if (-not (Test-Path -LiteralPath $OldMem)) { $problems += "Claude Code memory folder not found: $OldMem" }
if (Test-Path -LiteralPath (Join-Path $NewMemDir 'memory')) { $problems += "Claude Code memory already exists at the new name: $NewMemDir" }

Say "parent folder : $Parent"
foreach ($m in $Moves) { Say ("move          : {0}`n             -> {1}" -f $m.From, $m.To) }
foreach ($k in $links) { Say "shortcut      : $($k.Name)  ->  $($k.Path) $($k.Args)" }
Say "claude memory : $OldMem`n             -> $NewMemDir\memory (copy)"
if ($problems.Count) {
  foreach ($p in $problems) { Fail $p }
  Say 'Nothing was changed. Fix the line(s) above and run «نقل المشروع» again.' 'Yellow'
  Finish 2
}
Pass 'preflight: nothing running, every source present, no target in the way'
if ($DryRun) { Say 'Dry run: stopping here. Nothing was changed.' 'Yellow'; Finish 0 }

# ---------------------------------------------------------------- stage 1: move (all or nothing)
Say '== Stage 1: move' 'Cyan'
$undo = New-Object System.Collections.Generic.List[object]
$backup = Join-Path $env:TEMP ('alsuhaiby-move-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
function Rollback($why) {
  Fail $why
  Say 'Rolling back everything this run changed...' 'Yellow'
  for ($i = $undo.Count - 1; $i -ge 0; $i--) {
    $u = $undo[$i]
    try {
      switch ($u.Kind) {
        'mkdir'   { if (Get-ChildItem -LiteralPath $u.Path -Force) { throw "not empty, left as it is: $($u.Path)" }; [IO.Directory]::Delete($u.Path) }   # only empty folders this run created
        'move'    { [IO.Directory]::Move($u.To, $u.From) }
        'restore' { Copy-Item -LiteralPath $u.Backup -Destination $u.File -Force }
        'rmcopy'  { Remove-Item -LiteralPath $u.Path -Recurse -Force }              # only the memory COPY this run made
      }
      Say "  undone: $($u.What)"
    } catch { Fail "  could NOT undo: $($u.What) — $($_.Exception.Message)" }
  }
  Say 'The project is back where it was. Nothing was deleted.' 'Yellow'
  Finish 1
}
try {
  foreach ($d in @($Parent, (Join-Path $Parent 'media'), (Join-Path $Parent 'archive'))) {
    if (-not (Test-Path -LiteralPath $d)) {
      New-Item -ItemType Directory -Path $d | Out-Null
      $undo.Add(@{ Kind = 'mkdir'; Path = $d; What = "created $d" })
    }
  }
  foreach ($m in $Moves) {
    try { [IO.Directory]::Move($m.From, $m.To) }   # one rename: the whole folder moves or nothing does
    catch { Rollback "moving the $($m.Name) failed: $($_.Exception.Message) (a program or window is probably still open inside it: close Claude Code, terminals, editors and Explorer windows on it)" }
    $undo.Add(@{ Kind = 'move'; From = $m.From; To = $m.To; What = "moved $($m.Name) back" })
    Pass "moved $($m.Name)"
  }
  New-Item -ItemType Directory -Path $backup | Out-Null
  $n = 0
  foreach ($k in $links) {
    $n++
    $bk = Join-Path $backup "$n.lnk"
    Copy-Item -LiteralPath $k.File -Destination $bk
    $undo.Add(@{ Kind = 'restore'; Backup = $bk; File = $k.File; What = "shortcut restored: $($k.Name)" })
    try {
      $l = $deskNs.ParseName([IO.Path]::GetFileName($k.File)).GetLink
      $l.Path = $k.Path.Replace($OldSite, $NewSite)
      $l.Arguments = $k.Args.Replace($OldSite, $NewSite)
      $l.WorkingDirectory = $k.Dir.Replace($OldSite, $NewSite)
      if ($k.Icon) { $l.SetIconLocation($k.Icon.Replace($OldSite, $NewSite), $k.IconIdx) }
      $l.Save()
    } catch { Rollback "fixing shortcut «$($k.Name)» failed: $($_.Exception.Message)" }
    Pass "shortcut updated: $($k.Name)"
  }
  if (-not (Test-Path -LiteralPath $NewMemDir)) { New-Item -ItemType Directory -Path $NewMemDir | Out-Null; $undo.Add(@{ Kind = 'mkdir'; Path = $NewMemDir; What = "created $NewMemDir" }) }
  $nm = Join-Path $NewMemDir 'memory'
  Copy-Item -LiteralPath $OldMem -Destination $nm -Recurse
  $undo.Add(@{ Kind = 'rmcopy'; Path = $nm; What = 'removed the memory copy (the original is untouched)' })
  Pass 'Claude Code memory copied (the old one stays as it is)'
} catch { Rollback "unexpected error: $($_.Exception.Message)" }

# ---------------------------------------------------------------- stage 2: verify (any FAIL -> undo the move)
Say '== Stage 2: verify' 'Cyan'
$bad = 0
try {
foreach ($it in $deskNs.Items()) {
  if (-not $it.IsLink) { continue }
  $l = $it.GetLink; $icon = ''; [void]$l.GetIconLocation([ref]$icon)
  $all = $l.Path + ' ' + $l.Arguments + ' ' + $l.WorkingDirectory + ' ' + $icon
  if ($all -notlike "*$NewSite*" -and $all -notlike "*$OldSite*") { continue }
  $checks = @($l.Path, $l.WorkingDirectory) + ([regex]::Matches($l.Arguments, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }) + @($icon)
  $missing = $checks | Where-Object { $_ -and -not (Test-Path -LiteralPath $_) }
  if ($all -like "*$OldSite*") { Fail "shortcut «$($it.Name)» still points at the old folder"; $bad++ }
  elseif ($missing) { Fail "shortcut «$($it.Name)»: missing $($missing -join ', ')"; $bad++ }
  else { Pass "shortcut «$($it.Name)» -> $($l.Path) $($l.Arguments)" }
}
$need = @(
  (Join-Path $NewSite '.git'), (Join-Path $NewSite '.env'), (Join-Path $NewSite 'package.json'), (Join-Path $NewSite 'node_modules'),
  (Join-Path $Parent 'alsuhaiby-library\.git'), (Join-Path $Parent 'alsuhaiby-library\meta.json'), (Join-Path $Parent 'alsuhaiby-library\library.json'),
  (Join-Path $Parent 'media\downloads'), (Join-Path $Parent 'media\telegram-export\map.json'), (Join-Path $Parent 'media\telegram-export\video_files'),
  (Join-Path $NewMemDir 'memory\MEMORY.md')
)
foreach ($p in $need) { if (Test-Path -LiteralPath $p) { Pass "exists: $p" } else { Fail "missing: $p"; $bad++ } }
if (Test-Path -LiteralPath (Join-Path $NewSite 'alsuhaiby-library')) { Fail 'the private library is INSIDE the public site folder'; $bad++ }
$common = Join-Path $NewSite 'scripts\lib\common.js'
if (Test-Path -LiteralPath $common) {
  $url = 'file:///' + ($common -replace '\\', '/')
  $js = "import('$url').then(c=>{const fs=require('fs');for(const k of ['LIB_DIR','LIBRARY','VIDEO_DIR','DOWNLOAD_DIR'])console.log(k+'|'+c[k]+'|'+fs.existsSync(c[k]))})"
  # node's error text must not stop this script (Windows PowerShell turns it into a fatal error): run it via cmd, read both streams
  $tmpOut = Join-Path $env:TEMP 'alsuhaiby-move-nodecheck.txt'
  Push-Location $env:TEMP
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $p = Start-Process -FilePath 'node' -ArgumentList @('-e', ('"' + $js.Replace('"', '\"') + '"')) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError ($tmpOut + '.err')
    $out = @(Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue) + @(Get-Content -LiteralPath ($tmpOut + '.err') -ErrorAction SilentlyContinue | Select-Object -First 3)
  } catch { $out = @("node could not run: $($_.Exception.Message)") }
  finally { $ErrorActionPreference = $prev; Pop-Location }
  foreach ($line in $out) {
    $f = "$line".Split('|')
    if ($f.Count -eq 3 -and $f[2] -eq 'true' -and $f[1].StartsWith($Parent)) { Pass "site code finds $($f[0]) at $($f[1])" }
    else { Fail "site code: $line"; $bad++ }
  }
  if (-not $out) { Fail 'site code check gave no answer (node missing?)'; $bad++ }
}
} catch { Fail "verify stopped: $($_.Exception.Message)"; $bad++ }
if ($bad) { Rollback "$bad check(s) failed after the move" }
Say 'Move verified.' 'Green'

# ---------------------------------------------------------------- stage 3: archive + Recycle Bin (only after PASS)
Say '== Stage 3: archive and Recycle Bin' 'Cyan'
$archive = Join-Path $Parent 'archive'
$toArchive = @(
  (Join-Path $Downloads 'tiktok_top.csv'),
  (Join-Path $Downloads 'ملف-الصهيبي-الكامل-لجمناي.md'),
  (Join-Path $Downloads 'Telegram Desktop\5889539663_pin (2).mp4')
)
foreach ($p in $toArchive) {
  try {
    if (-not (Test-Path -LiteralPath $p)) { Say "skip (not there): $p" 'Yellow'; continue }
    $dest = Join-Path $archive (Split-Path -Leaf $p)
    if (Test-Path -LiteralPath $dest) { Fail "archive already has $(Split-Path -Leaf $p); left in place"; continue }
    Move-Item -LiteralPath $p -Destination $dest; Pass "archived: $p"
  } catch { Fail "archive $p : $($_.Exception.Message)" }
}
$vf = Join-Path $Parent 'media\telegram-export\video_files'
$dupes = @(
  @{ P = (Join-Path $Downloads '2023-11-29_2M_7306940447312645394.mp4');        Copy = (Join-Path $vf '5889539663_tk (28).mp4') },
  @{ P = (Join-Path $Downloads 'Telegram Desktop\5889539663_tk.mp4');           Copy = (Join-Path $vf '5889539663_tk (1).mp4') },
  @{ P = (Join-Path $Downloads 'Telegram Desktop\top\5889539663(1)_tk.mp4');    Copy = (Join-Path $vf '5889539663_tk (1).mp4') },
  @{ P = (Join-Path $Downloads 'Telegram Desktop\top\5889539663(2)_tk.mp4');    Copy = (Join-Path $vf '5889539663_tk (2).mp4') },
  @{ P = (Join-Path $Downloads 'Telegram Desktop\top\5889539663_tk.mp4');       Copy = (Join-Path $vf '5889539663_tk (50).mp4') }
)
function Recycle($p, $isDir) {
  if ($SandboxTest) { Remove-Item -LiteralPath $p -Recurse -Force; return }
  if ($isDir) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
}
foreach ($d in $dupes) {
  try {
    if (-not (Test-Path -LiteralPath $d.P)) { Say "skip (not there): $($d.P)" 'Yellow'; continue }
    if (-not (Test-Path -LiteralPath $d.Copy)) { Fail "kept $($d.P): its copy is missing"; continue }
    if ((Get-FileHash -LiteralPath $d.P -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $d.Copy -Algorithm SHA256).Hash) { Fail "kept $($d.P): not identical to its copy"; continue }
    Recycle $d.P $false; Pass "Recycle Bin (identical copy kept in media): $($d.P)"
  } catch { Fail "recycle $($d.P): $($_.Exception.Message)" }
}
$empty = Join-Path $Desktop 'الفيديوهات الناقصه'
try {
  if (Test-Path -LiteralPath $empty) {
    if (Get-ChildItem -LiteralPath $empty -Recurse -Force -File) { Fail "kept $empty : it is not empty any more" } else { Recycle $empty $true; Pass "Recycle Bin (empty folder): $empty" }
  } else { Say "skip (not there): $empty" 'Yellow' }
} catch { Fail "recycle $empty : $($_.Exception.Message)" }
foreach ($n in 'run-phase1b.log', 'run-phase1c.log', 'run-phase1d.log', 'run-write.log', 'run-review.log') {
  $p = Join-Path $NewSite "data\$n"
  try { if (Test-Path -LiteralPath $p) { Recycle $p $false; Pass "Recycle Bin (old Phase-1 log): $p" } else { Say "skip (not there): $p" 'Yellow' } }
  catch { Fail "recycle $p : $($_.Exception.Message)" }
}
$oldKatib = Join-Path $Downloads 'KatibSuhaibi'
try { if (Test-Path -LiteralPath $oldKatib) { Recycle $oldKatib $true; Pass "Recycle Bin (old copy of the Katib app): $oldKatib" } else { Say "skip (not there): $oldKatib" 'Yellow' } }
catch { Fail "recycle $oldKatib : $($_.Exception.Message)" }

if ($ClickFile -and -not $SandboxTest -and (Test-Path -LiteralPath $ClickFile)) {
  try { Recycle $ClickFile $false; Pass 'the «نقل المشروع» click-file went to the Recycle Bin (its job is done)' } catch { Fail "could not remove the click-file: $($_.Exception.Message)" }
}
Say ''
Say "DONE. Everything is in $Parent" 'Green'
Say "Open Claude Code in: $NewSite" 'Green'
Say "(log saved: $Parent\move-log.txt; shortcut backups: $backup)"
Finish 0
