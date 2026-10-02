// Páginas HTML: login, logout e índice (con definiciones de columnas inyectadas).
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { checkPasswordHash, findUserByUsername, loginRequired } from '../auth.js';
import { COLUMN_DISPLAY_NAMES, DYNAMIC_OPTIONS_COLUMNS } from '../constants.js';
import { DEBUG, DISABLE_AUTH, ROOT_DIR, logger } from '../config.js';
import { getCatalogOptions } from '../db.js';
import { removerAcentos } from '../util/py.js';

export const router = Router();
const cache = new Map();
const readView = (name) => {
  if (!DEBUG && cache.has(name)) return cache.get(name);
  const html = fs.readFileSync(path.join(ROOT_DIR, 'views', name), 'utf8');
  cache.set(name, html);
  return html;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.get('/login', (req, res) => {
  if (DISABLE_AUTH || req.user) return res.redirect('/');
  return res.type('html').send(readView('login.html').replace('<!--ERROR-->', ''));
});

router.post('/login', async (req, res) => {
  if (DISABLE_AUTH) return res.redirect('/');
  const { username = '', password = '' } = req.body || {};
  const user = await findUserByUsername(String(username));
  if (user && (await checkPasswordHash(user.password_hash, String(password)))) {
    return req.session.regenerate((err) => {
      if (err) return res.status(500).send('Error de sesión');
      req.session.userId = user.id;
      logger.info(`🔓 Inicio de sesión: ${user.username}`);
      return req.session.save(() => res.redirect('/'));
    });
  }
  logger.warn(`🔒 Intento de inicio de sesión fallido para '${String(username).slice(0, 40)}'`);
  return res
    .type('html')
    .send(readView('login.html').replace('<!--ERROR-->', '<div class="error-message">Usuario o contraseña incorrectos</div>'));
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/', loginRequired, async (_req, res) => {
  try {
    const defs = [];
    for (const name of COLUMN_DISPLAY_NAMES) {
      let key = removerAcentos(name.toLowerCase().replace(/ /g, '_'));
      if (name === 'ID') key = 'id';
      else if (name === 'Liga Web') key = 'liga_web';
      else if (name === 'Año') key = 'año';
      else if (name === 'Valor') key = 'valor';
      const info = { displayName: name, keyName: key, type: 'input', readonly: key === 'id' };
      if (DYNAMIC_OPTIONS_COLUMNS.includes(key)) {
        info.type = 'select';
        info.options = await getCatalogOptions(key);
      }
      defs.push(info);
    }
    const script = `<script>window.COLUMN_DEFINITIONS = ${JSON.stringify(defs).replace(/<\/script>/gi, '<\\/script>')};</script>`;
    return res.type('html').send(readView('index.html').replace('</head>', `${script}</head>`));
  } catch (e) {
    logger.error(`Error al renderizar el índice: ${e.stack}`);
    return res.status(500).send(`Error al renderizar el índice: ${esc(e.message)}`);
  }
});
