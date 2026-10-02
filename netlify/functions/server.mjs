// Función de Netlify: envuelve la app Express con serverless-http.
import serverless from 'serverless-http';
import app from '../../src/app.js';
import { initApp } from '../../src/init.js';

const handle = serverless(app, { binary: ['application/zip', 'application/octet-stream', 'image/*', 'font/*'] });

export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await initApp();
  return handle(event, context);
};
