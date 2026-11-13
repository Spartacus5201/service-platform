@echo off
REM Double-click to run Service Platform on this computer.
cd /d "%~dp0"
node scripts\start-local.mjs
pause
