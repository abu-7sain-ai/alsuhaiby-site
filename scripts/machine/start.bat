@echo off
rem Starts the machine guard (hidden) and the meters window. Each runs once only; starting again does nothing.
rem Not registered with Windows yet (his decision 2026-11-08): when he approves, a shortcut to this file goes into the Startup folder.
cd /d "%~dp0..\.."
start "" pythonw scripts\machine\watcher.py
start "" pythonw scripts\machine\meters.pyw
