#!/usr/bin/env bash
# Gestor de Variables - arranque en modo debug (Linux/macOS/Git Bash)
# Uso: ./iniciar.sh [start]   (sin argumentos: debug con recarga automática)
set -e
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "[ERROR] Node.js no está instalado (se requiere v20+)."; exit 1; }
[ -f .env ] || { echo "[ERROR] Falta el archivo .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...)."; exit 1; }
[ -d node_modules ] || { echo "Instalando dependencias..."; npm install; }

echo "Verificando tablas en Supabase..."
if ! npm run --silent db:setup -- --check; then
  echo
  echo "[AVISO] Faltan tablas. Ejecuta db/schema.sql en el SQL Editor de Supabase."
  echo "        La app arrancará, pero las pantallas no cargarán datos hasta entonces."
  echo
fi

if [ "$1" = "start" ]; then
  npm start
else
  DEBUG=true npm run dev
fi
