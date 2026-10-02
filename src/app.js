// Gestor de Variables – SESNA · aplicación Express (sin listen; ver server.js y netlify/functions/server.mjs).
import crypto from 'node:crypto';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import session from 'cookie-session';
import { COOKIE_SECURE, DEBUG, IS_PROD, ROOT_DIR, SESSION_SECRET, TRUST_PROXY, logger } from './config.js';
import { loadUser } from './auth.js';
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

// Sesión sin estado (cookie firmada): funciona en serverless y en varios procesos.
app.use(
  session({
    name: 'gv.sid',
    secret: SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 12,
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

export default app;
