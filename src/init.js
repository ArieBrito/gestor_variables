// Inicialización compartida (servidor Node y función de Netlify): modelos, catálogos, admin y cachés.
import { ensureAdminUser } from './auth.js';
import { loadAllCatalogs } from './catalogs.js';
import { logger } from './config.js';
import { refreshCaches } from './db.js';
import { loadModels } from './ml.js';

let ready = null;

export function initApp() {
  ready ||= (async () => {
    loadModels();
    await loadAllCatalogs();
    await ensureAdminUser();
    await refreshCaches(true).catch((e) => logger.warn(`Caché inicial no disponible: ${e.message}`));
  })().catch((e) => {
    ready = null; // permitir reintento en la siguiente invocación
    throw e;
  });
  return ready;
}
