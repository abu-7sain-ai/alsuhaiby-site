@echo off
rem Opens the window «مراقب الجهاز»; the window starts its own watcher, and closing it stops that watcher.
rem Nothing is registered with Windows (his decision 2026-11-08): only the desktop shortcut «مراقب الجهاز» opens it.
cd /d "%~dp0..\.."
start "" pythonw scripts\machine\meters.pyw
