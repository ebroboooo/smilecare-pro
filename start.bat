@echo off
cd /d "%~dp0"
if not exist "server\.env" copy "server\.env.example" "server\.env"
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
set NODE_ENV=production
call npm start
