' Hidden launcher for the scheduled task «alsuhaiby-prep-supervisor»: starts the prep supervisor only if none is running.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\HP\Desktop\alsuhaiby-site"
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\prep-supervisor.js --ensure", 0, False
