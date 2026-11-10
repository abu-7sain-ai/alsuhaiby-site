@echo off
rem Desktop shortcut "bayanat" runs this: NUMBERS ONLY (yt-dlp metadata -> private library; no Zernio). No Claude, no Gemini.
rem Closing the window at any time is safe: the next run continues where it stopped.
chcp 65001 >nul
title alsuhaiby numbers
cd /d "%~dp0.."
node scripts\meta.js --part=numbers %*
echo.
echo Press any key to close.
pause >nul
