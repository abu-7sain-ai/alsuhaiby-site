@echo off
rem Desktop shortcut runs this: the night run (Line 1), then a short Arabic summary.
rem Closing the window at any time is safe: the run resumes where it stopped.
chcp 65001 >nul
title alsuhaiby - night run
cd /d "%~dp0.."
node scripts\night.js
echo.
node scripts\night-summary.js
pause >nul
