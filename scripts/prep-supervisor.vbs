' Hidden launcher for the scheduled task «alsuhaiby-prep-supervisor»: starts one prep burst (scripts/prep-burst.js).
' The runner reads the real 5-hour reset from Claude and times the burst from it (reset - 60 min → reset - 2 min); a late or early fire is corrected there.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\HP\Desktop\alsuhaiby-site"
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\prep-burst.js", 0, False
