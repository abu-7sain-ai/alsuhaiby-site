' Hidden launcher for the scheduled task «alsuhaiby-audit-daily»: starts the daily content audit (scripts/audit-daily.js).
' It does nothing when today's audit is already done (marker data/audit-daily.json); missed days are caught up there (7 per day, max 21).
' The site folder is found from this file's own place (scripts\..), so moving the project never breaks it.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\audit-daily.js", 0, False
