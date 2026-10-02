# 📊 Gestor de Variables – SESNA (Node.js + Supabase)

Gestión, carga masiva (CSV / ZIP del INEGI) y categorización automática de variables e indicadores.
Migrado desde Flask/Jupyter (`gestor_de_variables.ipynb`, conservado como referencia) a **Node.js 20+ / Express 5**.

## Arranque rápido

```bash
npm install
# 1) Crear la base de datos: pegar db/schema.sql en Supabase > SQL Editor (idempotente)
# 2) Configurar .env (ver abajo)
iniciar.bat            # Windows  · o  ./iniciar.sh en Linux/macOS/Git Bash
```

`iniciar.bat` / `iniciar.sh` verifican Node, `.env` y dependencias, comprueban las tablas y arrancan en **modo debug con recarga automática**.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Debug + recarga automática (`node --watch`) |
| `npm run debug` | Igual, con inspector (`--inspect`, depurador en `chrome://inspect`) |
| `npm start` | Producción (`DEBUG=false` recomendado) |
| `npm run db:setup` | Aplica `db/schema.sql` por Postgres directo, pooler o Management API; `-- --check` solo verifica |
| `npm test` | Pruebas (hashes Werkzeug, pipeline ZIP) |
| `node scripts/build-schema.js` | Regenera `db/schema.sql` desde `src/constants.js` |

## Variables de entorno (`.env`)

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Conexión del backend (la `SUPABASE_KEY` anon es solo respaldo) |
| `DATABASE_URL` | Solo para `npm run db:setup` |
| `SUPABASE_ACCESS_TOKEN` | Opcional: `db:setup` vía Management API (HTTPS) si no hay acceso a Postgres |
| `PORT` | Puerto preferido (si está ocupado busca el siguiente libre) |
| `DEBUG` | `true`: logs detallados, trazas en errores JSON, plantillas sin caché |
| `DISABLE_AUTH` | `true`: sin login (todos son admin) |
| `SESSION_SECRET` | Opcional: mantiene las sesiones entre reinicios |
| `NGROK_AUTH_TOKEN` | Opcional: túnel público |

## Base de datos

`db/schema.sql` crea `variables` (jerarquía `parent_id`), `usuarios`, `cargas` y los catálogos
`proceso`, `eje`, `tema`, `cobertura`, `periodicidad`, `estado`, con RLS activado y sin políticas
(solo el backend con `service_role` accede). Primer arranque con `usuarios` vacía: crea `admin / admin123` (cámbiala).

Las contraseñas usan el formato de Werkzeug (`scrypt:…` y `pbkdf2:…`), por lo que los usuarios existentes de la versión Flask siguen entrando.

## Estructura

```
src/server.js            Express, sesión, arranque, ngrok
src/config.js            .env + logger (debug)
src/db.js                Cliente Supabase, cachés, IDs 'A-00001'
src/auth.js              Hashes Werkzeug, middlewares de sesión/rol
src/ml.js                TF-IDF + Naive Bayes (JSON en modelos/) y fallback por palabras clave
src/batch.js             Upsert por lotes (padres → hijos), borrado robusto
src/processing/          CSV, diccionarios, desagregación y pipeline ZIP
src/routes/              pages, variables, uploads, admin
public/ · views/         Frontend (SPA) y plantillas
db/schema.sql · scripts/ Esquema y utilidades de BD
```

## Notas de la migración

- Los modelos ML ya no son `.pkl` de scikit-learn: se entrenan y guardan como `modelos/modelo_*.json` (reentrenar desde la UI). Mientras no existan, se usa el fallback por palabras clave.
- El procesamiento de ZIP corre en el mismo proceso, cediendo el control al event loop entre archivos.
- Mejoras respecto al notebook: la columna **Año** ahora se exporta en la descarga CSV, las sugerencias de catálogo devuelven el valor sugerido y no se consumen IDs al previsualizar ZIP.
