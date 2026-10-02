// Utilidades compartidas de las rutas.
import { DEBUG, logger } from '../config.js';

/** Respuesta de error JSON; en modo debug incluye la traza. */
export function fail(res, e, status = 500, extra = {}) {
  logger.error(`❌ ${res.req?.method} ${res.req?.originalUrl}: ${e?.message || e}`);
  if (DEBUG && e?.stack) logger.debug(e.stack);
  return res.status(status).json({ error: e?.message || String(e), ...(DEBUG && e?.stack ? { traceback: e.stack } : {}), ...extra });
}

/** Orden de prioridad de la previsualización: duplicados, luego nuevos en catálogo, luego el resto. */
export const priorityKey = (row) => (row._is_duplicate ? 0 : Object.values(row._nuevo_en_catalogo || {}).some(Boolean) ? 1 : 2);
