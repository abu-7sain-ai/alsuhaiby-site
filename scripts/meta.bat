@echo off
rem Desktop shortcut "bayanat" runs this: NUMBERS + COMMENTS ONLY (yt-dlp metadata + Zernio -> private library). No Claude, no Gemini.
rem Closing the window at any time is safe: the next run continues where it stopped.
chcp 65001 >nul
title alsuhaiby meta
cd /d "%~dp0.."
node scripts\meta.js %*
echo.
echo Press any key to close.
pause >nul
