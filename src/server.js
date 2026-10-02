// Gestor de Variables – SESNA · arranque como servidor Node tradicional.
import net from 'node:net';
import app from './app.js';
import { DEBUG, DISABLE_AUTH, HOST, NGROK_AUTH_TOKEN, NODE_ENV, PORT, PORT_SCAN_RANGE, USING_SERVICE_ROLE, logger } from './config.js';
import { initApp } from './init.js';

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
  await initApp();

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
