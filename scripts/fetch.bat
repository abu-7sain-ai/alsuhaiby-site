@echo off
rem Desktop shortcut "tanzeel" runs this: DOWNLOAD ONLY (yt-dlp -> R2 -> library). No Claude, no Gemini.
rem Closing the window at any time is safe: the next run continues where it stopped.
chcp 65001 >nul
title alsuhaiby fetch
cd /d "%~dp0.."
node scripts\fetch.js %*
echo.
echo Press any key to close.
pause >nul
