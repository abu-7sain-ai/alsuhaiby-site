' Hidden launcher for the scheduled task «alsuhaiby-prep-supervisor»: starts one prep burst (scripts/prep-burst.js).
' The runner reads the real 5-hour reset from Claude and times the burst from it (reset - 60 min → reset - 2 min); a late or early fire is corrected there.
' The site folder is found from this file's own place (scripts\..), so moving the project never breaks it.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\prep-burst.js", 0, False
