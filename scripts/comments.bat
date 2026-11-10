@echo off
rem Desktop shortcut "taaliqat" runs this: COMMENTS ONLY (Zernio -> private library, slow background project). No Claude, no Gemini.
rem Closing the window at any time is safe: the next run continues where it stopped.
chcp 65001 >nul
title alsuhaiby comments
cd /d "%~dp0.."
node scripts\meta.js --part=comments %*
echo.
echo Press any key to close.
pause >nul
