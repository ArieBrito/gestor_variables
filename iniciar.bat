@echo off
rem Gestor de Variables - arranque en modo debug (Windows)
rem Uso: iniciar.bat [start]   (sin argumentos: debug con recarga automatica)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado ^(se requiere v20 o superior^).
  exit /b 1
)

if not exist ".env" (
  echo [ERROR] Falta el archivo .env ^(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...^).
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install || exit /b 1
)

echo Verificando tablas en Supabase...
call npm run --silent db:setup -- --check
if errorlevel 1 (
  echo.
  echo [AVISO] Faltan tablas. Ejecuta db\schema.sql en el SQL Editor de Supabase.
  echo         La app arrancara, pero las pantallas no cargaran datos hasta entonces.
  echo.
)

if /i "%1"=="start" (
  call npm start
) else (
  set DEBUG=true
  call npm run dev
)
