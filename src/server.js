// Gestor de Variables – SESNA · servidor Express (Módulos 9-11 del notebook).
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import session from 'express-session';
import {
  COOKIE_SECURE, DEBUG, DISABLE_AUTH, HOST, IS_PROD, NGROK_AUTH_TOKEN, NODE_ENV, PORT, PORT_SCAN_RANGE, ROOT_DIR, SESSION_SECRET, TRUST_PROXY,
  USING_SERVICE_ROLE, logger,
} from './config.js';
import { ensureAdminUser, loadUser } from './auth.js';
import { loadAllCatalogs } from './catalogs.js';
import { refreshCaches } from './db.js';
import { loadModels } from './ml.js';
import { router as adminRoutes } from './routes/admin.js';
import { router as pagesRoutes } from './routes/pages.js';
import { router as uploadRoutes } from './routes/uploads.js';
import { router as variableRoutes } from './routes/variables.js';

if (!IS_PROD && !SESSION_SECRET) logger.warn('SESSION_SECRET no definido: las sesiones se pierden al reiniciar.');

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY === 'true' ? true : TRUST_PROXY);

// Cabeceras de seguridad básicas
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    ...(IS_PROD && COOKIE_SECURE ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
  });
  next();
});

// Healthcheck para balanceadores / monitoreo (sin sesión ni acceso a BD)
app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

app.use(compression());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

app.use(
  session({
    name: 'gv.sid',
    secret: SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: 1000 * 60 * 60 * 12 },
  })
);

// Log de peticiones (solo en debug)
if (DEBUG) {
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      logger.debug(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(1)} ms)`);
    });
    next();
  });
}

app.use('/static', express.static(path.join(ROOT_DIR, 'public'), { etag: true, maxAge: DEBUG ? 0 : '1h' }));
app.use(loadUser);
app.use(pagesRoutes);
app.use(variableRoutes);
app.use(uploadRoutes);
app.use(adminRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejo de errores (multer, JSON inválido, etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error(`💥 ${req.method} ${req.originalUrl}: ${err.stack || err}`);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (req.originalUrl.startsWith('/api')) {
    return res.status(status).json({ error: err.message, ...(DEBUG ? { traceback: err.stack } : {}) });
  }
  return res.status(status).send(DEBUG ? `<pre>${String(err.stack || err).replace(/</g, '&lt;')}</pre>` : 'Error interno');
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });

async function findAvailablePort(start, tries = PORT_SCAN_RANGE) {
  for (let p = start; p < start + tries; p++) if (await portFree(p)) return p;
  throw new Error(`No hay puertos libres entre ${start} y ${start + tries - 1}.`);
}

async function startNgrok(port) {
  if (!NGROK_AUTH_TOKEN) return null;
  try {
    const ngrok = await import('@ngrok/ngrok');
    const listener = await ngrok.forward({ addr: port, authtoken: NGROK_AUTH_TOKEN });
    return listener.url();
  } catch (e) {
    logger.warn(`⚠️ Error ngrok: ${e.message}`);
    return null;
  }
}

async function main() {
  logger.info(`🚀 Iniciando Gestor de Variables (NODE_ENV=${NODE_ENV}, DEBUG=${DEBUG}, auth=${DISABLE_AUTH ? 'desactivada' : 'activa'}, llave=${USING_SERVICE_ROLE ? 'service_role' : 'anon'})`);
  loadModels();
  await loadAllCatalogs();
  await ensureAdminUser();
  await refreshCaches(true).catch((e) => logger.warn(`Caché inicial no disponible: ${e.message}`));

  const port = await findAvailablePort(PORT);
  const server = app.listen(port, HOST, async () => {
    const url = await startNgrok(port);
    const line = '='.repeat(70);
    console.log(`\n${line}\n✅ APP LISTA${url ? '' : ' (solo local)'}\n${line}`);
    if (url) console.log(`🌐 PÚBLICA (ngrok) : ${url}`);
    console.log(`🖥️  LOCAL           : http://127.0.0.1:${port}\n${line}\n`);
  });
  server.requestTimeout = 10 * 60 * 1000; // cargas ZIP grandes
  const shutdown = (sig) => {
    logger.info(`Recibido ${sig}, cerrando...`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (e) => logger.error(`unhandledRejection: ${e?.stack || e}`));
process.on('uncaughtException', (e) => {
  logger.error(`uncaughtException: ${e?.stack || e}`);
  process.exit(1); // que el supervisor (pm2/systemd/docker) reinicie el proceso
});

main().catch((e) => {
  logger.error(`❌ No se pudo iniciar: ${e.stack || e.message}`);
  process.exit(1);
});
