' Hidden launcher for the scheduled task «alsuhaiby-prep-supervisor»: starts one prep burst (scripts/prep-burst.js).
' The runner itself checks the burst window, so a late start (PC asleep at the burst time) outside a window runs nothing.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\HP\Desktop\alsuhaiby-site"
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\prep-burst.js", 0, False
