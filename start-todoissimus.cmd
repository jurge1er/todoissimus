@echo off
REM Start Todoissimus proxy + frontend
cd /d "%~dp0"
echo Starting Todoissimus on http://localhost:5173 ...
echo (Close this window to stop)
npm start

