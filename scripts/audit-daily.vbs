' Hidden launcher for the scheduled task «alsuhaiby-audit-daily»: starts the daily content audit (scripts/audit-daily.js).
' It does nothing when today's audit is already done (marker data/audit-daily.json); missed days are caught up there (7 per day, max 21).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\HP\Desktop\alsuhaiby-site"
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\audit-daily.js", 0, False
