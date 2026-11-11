Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\HP\Desktoplsuhaiby-site"
sh.Run """C:\Program Files
odejs
ode.exe"" scripts\prep-supervisor.js --ensure", 0, False
