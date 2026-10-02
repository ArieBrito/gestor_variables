// Autenticación: usuarios en Supabase, hashes compatibles con Werkzeug (scrypt / pbkdf2).
import crypto from 'node:crypto';
import { DISABLE_AUTH, logger } from './config.js';
import { must, supabase } from './db.js';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const randomSalt = (len = 16) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
};

const scrypt = (password, salt, N, r, p) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N, r, p, maxmem: 132 * N * r * p }, (e, key) => (e ? reject(e) : resolve(key)))
  );

/** generate_password_hash (Werkzeug): scrypt:N:r:p$salt$hex */
export async function generatePasswordHash(password) {
  const salt = randomSalt();
  const key = await scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}$${salt}$${key.toString('hex')}`;
}

/** check_password_hash (Werkzeug): soporta scrypt y pbkdf2. */
export async function checkPasswordHash(hash, password) {
  try {
    const [method, salt, expected] = String(hash).split('$');
    if (!method || salt === undefined || !expected) return false;
    const parts = method.split(':');
    let actual;
    if (parts[0] === 'scrypt') {
      const [, n, r, p] = parts;
      actual = (await scrypt(password, salt, Number(n || SCRYPT_N), Number(r || SCRYPT_R), Number(p || SCRYPT_P))).toString('hex');
    } else if (parts[0] === 'pbkdf2') {
      const digest = parts[1] || 'sha256';
      const iterations = Number(parts[2] || 600000);
      actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length / 2, digest).toString('hex');
    } else return false;
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const toUser = (u) => (u ? { id: u.id, username: u.username, password_hash: u.password_hash, rol: u.rol || 'user' } : null);

export async function findUserById(id) {
  try {
    const { data } = await must(supabase.from('usuarios').select('*').eq('id', id));
    return toUser(data?.[0]);
  } catch (e) {
    logger.warn(`findUserById: ${e.message}`);
    return null;
  }
}

export async function findUserByUsername(username) {
  try {
    const { data } = await must(supabase.from('usuarios').select('*').eq('username', username));
    return toUser(data?.[0]);
  } catch (e) {
    logger.warn(`findUserByUsername: ${e.message}`);
    return null;
  }
}

/** Crea admin/admin123 si la tabla de usuarios está vacía. */
export async function ensureAdminUser() {
  if (DISABLE_AUTH) {
    logger.info('Autenticación deshabilitada (DISABLE_AUTH=true).');
    return;
  }
  try {
    const { count } = await must(supabase.from('usuarios').select('id', { count: 'exact', head: true }));
    if (count === 0) {
      await must(
        supabase.from('usuarios').insert({ username: 'admin', password_hash: await generatePasswordHash('admin123'), rol: 'admin' })
      );
      logger.info('✅ Usuario administrador creado: admin / admin123 (cámbiala).');
    }
  } catch (e) {
    logger.error(`❌ Error al verificar/crear usuario admin: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------
/** Sesión → req.user (cargado desde Supabase en cada petición, como flask-login). */
export async function loadUser(req, _res, next) {
  if (DISABLE_AUTH || !req.session?.userId) return next();
  req.user = await findUserById(req.session.userId);
  if (!req.user) delete req.session.userId;
  next();
}

/** @login_required: redirige al login (para páginas). */
export function loginRequired(req, res, next) {
  if (DISABLE_AUTH || req.user) return next();
  return res.redirect('/login');
}

/** @optional_login_required: 401 JSON (para la API). */
export function apiAuth(req, res, next) {
  if (DISABLE_AUTH || req.user) return next();
  return res.status(401).json({ error: 'No autenticado. Inicia sesión para acceder a este recurso.' });
}

/** @admin_required */
export function adminRequired(req, res, next) {
  if (DISABLE_AUTH || (req.user && req.user.rol === 'admin')) return next();
  return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
}
