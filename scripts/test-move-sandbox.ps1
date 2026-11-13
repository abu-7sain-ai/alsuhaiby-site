# test-move-sandbox.ps1 — runs move-project.ps1 against a fake copy of the layout inside %TEMP% (never touches the real project).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-move-sandbox.ps1
param([switch]$KeepOnFail)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'move-project.ps1'
$realSite = Split-Path -Parent $here
$fails = 0
function Check($ok, $what) { if ($ok) { Write-Host "  ok    $what" -ForegroundColor Green } else { Write-Host "  FAIL  $what" -ForegroundColor Red; $script:fails++ } }

function NewSandbox($tag, $break) {
  $S = Join-Path $env:TEMP ("alsuhaiby-move-sandbox-$tag-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
  $Desk = Join-Path $S 'Desktop'; $Vid = Join-Path $S 'Videos'; $DlDir = Join-Path $S 'Downloads'; $CP = Join-Path $S 'claude'; $DDrv = Join-Path $S 'D'
  foreach ($q in $Desk, $Vid, $DlDir, $CP, $DDrv) { New-Item -ItemType Directory -Force -Path $q | Out-Null }
  $site = Join-Path $Desk 'alsuhaiby-site'; $lib = Join-Path $Desk 'alsuhaiby-library'
  foreach ($d in "$site\.git", "$site\node_modules", "$site\scripts\lib", "$site\data", "$lib\.git") { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  Copy-Item (Join-Path $realSite 'scripts\lib\common.js') "$site\scripts\lib\common.js"
  Set-Content "$site\package.json" '{"type":"module"}'; Set-Content "$site\.env" 'X=1'
  Set-Content "$site\scripts\fetch.bat" '@echo off'; Set-Content "$site\scripts\icon.ico" 'x'
  Set-Content "$lib\meta.json" '{}'; Set-Content "$lib\library.json" '[]'
  # videos: 3 on R2, in the downloads folder
  Set-Content "$site\data\r2.json" '{"111":{"ok":1},"222":{"ok":1},"333":{"ok":1}}'
  $dlv = Join-Path $Vid 'alsuhaiby-downloads'; New-Item -ItemType Directory -Force -Path $dlv | Out-Null
  foreach ($i in '111', '222', '333') { Set-Content (Join-Path $dlv "$i.mp4") "video $i" }
  if ($break -eq 'notonr2') { Set-Content (Join-Path $dlv '999.mp4') 'not on r2' }
  $ex = Join-Path $Vid 'ChatExport_2026-10-30'; New-Item -ItemType Directory -Force -Path "$ex\video_files" | Out-Null
  Set-Content "$ex\map.json" '[]'; 1..20 | % { Set-Content "$ex\video_files\v$_.mp4" ("data " * $_) }
  New-Item -ItemType Directory -Force -Path (Join-Path $CP 'x') | Out-Null
  # claude memory under the old path's key
  $key = ($site -replace '[^A-Za-z0-9]', '-'); New-Item -ItemType Directory -Force -Path "$CP\$key\memory" | Out-Null; Set-Content "$CP\$key\memory\MEMORY.md" '- test'
  # downloads folder research files
  Set-Content (Join-Path $DlDir 'tiktok_top.csv') 'a,b'
  # 5 shortcuts
  $sh = New-Object -ComObject WScript.Shell
  foreach ($n in 'one', 'two', 'three', 'four', 'five') { $l = $sh.CreateShortcut((Join-Path $Desk "$n.lnk")); $l.TargetPath = "$site\scripts\fetch.bat"; $l.WorkingDirectory = $site; $l.IconLocation = "$site\scripts\icon.ico,0"; $l.Save() }
  if ($break -eq 'noenv') { Remove-Item "$site\.env" }   # makes stage 2 fail -> rollback
  $tn = 'alsuhaiby-sandbox-task-' + [guid]::NewGuid().ToString('N').Substring(0, 5)
  $act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument 'scripts\audit-daily.vbs' -WorkingDirectory $site
  Register-ScheduledTask -TaskName $tn -Action $act -Trigger (New-ScheduledTaskTrigger -Once -At '2031-01-01 10:00') | Out-Null
  return @{ S = $S; Desk = $Desk; Vid = $Vid; Dl = $DlDir; CP = $CP; D = $DDrv; Task = $tn; Site = $site }
}
function Run($sb) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Desktop $sb.Desk -Videos $sb.Vid -Downloads $sb.Dl -ClaudeProjects $sb.CP -DRoot ($sb.D + '\') -TaskName $sb.Task -NoPause -SandboxTest 2>&1 | Out-Host
  return $LASTEXITCODE
}

Write-Host '== Test 1: success' -ForegroundColor Cyan
$a = NewSandbox 'ok' ''
$code = Run $a
$P = Join-Path $a.Desk 'alsuhaiby'
Check ($code -eq 0) "exit code 0 (got $code)"
Check (Test-Path "$P\alsuhaiby-site\.git") 'site moved next to the library'
Check (Test-Path "$P\alsuhaiby-library\meta.json") 'library moved'
Check (-not (Test-Path "$P\alsuhaiby-site\alsuhaiby-library")) 'library is not inside the site'
Check (Test-Path "$($a.D)\alsuhaiby\telegram-export\video_files\v20.mp4") 'telegram export copied to the fake D:'
Check (-not (Test-Path "$($a.Vid)\ChatExport_2026-10-30")) 'original export removed after verify (sandbox: no bin)'
Check (-not (Test-Path "$($a.Vid)\alsuhaiby-downloads")) 'downloads folder removed (all on R2)'
Check (Test-Path "$P\archive\tiktok_top.csv") 'research file archived'
Check ((Get-ScheduledTask $a.Task).Actions[0].WorkingDirectory -eq "$P\alsuhaiby-site") 'task working folder updated'
Check ((Get-ScheduledTask $a.Task).State -ne 'Disabled') 'task is enabled again'
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $a.Desk 'one.lnk'))
Check ($lnk.TargetPath -like "$P\alsuhaiby-site\*" -and $lnk.WorkingDirectory -eq "$P\alsuhaiby-site") 'shortcut points at the new folder'
Check (Test-Path ("$($a.CP)\" + (("$P\alsuhaiby-site" -replace '[^A-Za-z0-9]', '-')) + '\memory\MEMORY.md')) 'claude memory copied to the new name'
Unregister-ScheduledTask -TaskName $a.Task -Confirm:$false

Write-Host '== Test 2: verify fails (.env missing) -> full rollback' -ForegroundColor Cyan
$b = NewSandbox 'rb' 'noenv'
$code = Run $b
Check ($code -eq 1) "exit code 1 (got $code)"
Check (Test-Path "$($b.Desk)\alsuhaiby-site\.git") 'site back in place'
Check (Test-Path "$($b.Desk)\alsuhaiby-library\meta.json") 'library back in place'
Check (-not (Test-Path "$($b.Desk)\alsuhaiby")) 'parent folder removed again'
Check (-not (Test-Path "$($b.D)\alsuhaiby")) 'nothing left on the fake D:'
Check (Test-Path "$($b.Vid)\ChatExport_2026-10-30\video_files\v20.mp4") 'original export untouched'
Check (Test-Path "$($b.Vid)\alsuhaiby-downloads\111.mp4") 'downloads untouched'
Check ((Get-ScheduledTask $b.Task).Actions[0].WorkingDirectory -eq $b.Site) 'task working folder restored'
Check ((Get-ScheduledTask $b.Task).State -ne 'Disabled') 'task enabled as before'
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $b.Desk 'one.lnk'))
Check ($lnk.WorkingDirectory -eq $b.Site) 'shortcut restored'
Unregister-ScheduledTask -TaskName $b.Task -Confirm:$false

Write-Host '== Test 3: a video not on R2 -> downloads kept, move still fine' -ForegroundColor Cyan
$c = NewSandbox 'r2' 'notonr2'
$code = Run $c
Check ($code -eq 0) "exit code 0 (got $code)"
Check (Test-Path "$($c.Vid)\alsuhaiby-downloads\999.mp4") 'downloads folder kept (999 not on R2)'
Unregister-ScheduledTask -TaskName $c.Task -Confirm:$false

Write-Host '== Test 4: dry run changes nothing' -ForegroundColor Cyan
$d = NewSandbox 'dry' ''
& powershell -NoProfile -ExecutionPolicy Bypass -File $script -Desktop $d.Desk -Videos $d.Vid -Downloads $d.Dl -ClaudeProjects $d.CP -DRoot ($d.D + '\') -TaskName $d.Task -NoPause -SandboxTest -DryRun 2>&1 | Out-Host
Check (Test-Path "$($d.Desk)\alsuhaiby-site\.git") 'site still in place'
Check (-not (Test-Path "$($d.Desk)\alsuhaiby")) 'no parent folder created'
Unregister-ScheduledTask -TaskName $d.Task -Confirm:$false

foreach ($x in $a, $b, $c, $d) { if (-not $KeepOnFail -or -not $fails) { Remove-Item -LiteralPath $x.S -Recurse -Force -ErrorAction SilentlyContinue } }
if ($fails) { Write-Host "$fails check(s) FAILED" -ForegroundColor Red; exit 1 } else { Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green }
