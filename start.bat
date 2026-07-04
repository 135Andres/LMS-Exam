@echo off
cd /d "%~dp0"
echo.
echo === LMS Exam - Iniciando Servidores ===
echo.
echo Python Auth : http://localhost:3001
echo Node.js App : http://localhost:3000
echo.

start "Python Auth" cmd /c "cd /d backend-python && python -m uvicorn main:app --host 0.0.0.0 --port 3001 --reload"
start "Node.js App" cmd /c "cd /d backend && npx tsx watch server.ts"

echo.
echo Servidores iniciados. Cierra esta ventana para terminar.
echo.
pause
