// Configuración global: variables de entorno + logger (modo debug).
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const truthy = (v, def = false) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';
export const DEBUG = truthy(process.env.DEBUG, NODE_ENV !== 'production');
export const DISABLE_AUTH = truthy(process.env.DISABLE_AUTH, false);
export const PORT = parseInt(process.env.PORT || process.env.FLASK_PORT || '8000', 10);
export const PORT_SCAN_RANGE = IS_PROD ? 1 : 100; // en producción no se salta a otro puerto
export const HOST = process.env.HOST || '0.0.0.0';
// Detrás de un proxy inverso (nginx, IIS, balanceador): número de saltos o 'true'. Necesario para cookies seguras.
export const TRUST_PROXY = process.env.TRUST_PROXY || '';
// Cookie de sesión con flag Secure (requiere HTTPS). Por defecto: activa en producción.
export const COOKIE_SECURE = truthy(process.env.COOKIE_SECURE, IS_PROD);
// Contraseña inicial del admin cuando la tabla usuarios está vacía.
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
export const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
export const USING_SERVICE_ROLE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
export const NGROK_AUTH_TOKEN = (process.env.NGROK_AUTH_TOKEN || '').trim();
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

if (IS_PROD) {
  const problems = [];
  if (DISABLE_AUTH) problems.push('DISABLE_AUTH=true no está permitido en producción');
  if (SESSION_SECRET.length < 32) problems.push('SESSION_SECRET es obligatorio en producción (mín. 32 caracteres)');
  if (problems.length) throw new Error(`❌ Configuración de producción inválida: ${problems.join('; ')}`);
}

// Parámetros de negocio (idénticos al notebook)
export const CACHE_TTL = 60; // segundos
export const UMBRAL_CONFIANZA = 0.92;
export const PREVIEW_EXPIRE_SECONDS = 600;
export const TASK_TTL_COMPLETED = 300;
export const TASK_TTL_HARD = 3600;
export const ZIP_SESSION_TTL = 1800;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export const IS_SERVERLESS = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
// En serverless solo /tmp es escribible (y es efímero).
export const MODELS_DIR = IS_SERVERLESS ? path.join(os.tmpdir(), 'modelos') : path.join(ROOT_DIR, 'modelos');
export const MODEL_PATHS = {
  proceso: path.join(MODELS_DIR, 'modelo_proceso.json'),
  eje: path.join(MODELS_DIR, 'modelo_eje.json'),
  tema: path.join(MODELS_DIR, 'modelo_tema.json'),
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
let currentLevel = DEBUG ? LEVELS.debug : LEVELS.warn;

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const fmt = (a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : safeInspect(a));
function safeInspect(o) {
  try {
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
}

function emit(level, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const tty = process.stdout.isTTY;
  const tag = level.toUpperCase().padEnd(5);
  const line = `${ts()} ${tag} ${args.map(fmt).join(' ')}`;
  const out = tty ? `${COLORS[level]}${line}${RESET}` : line;
  (level === 'error' || level === 'warn' ? console.error : console.log)(out);
}

export const logger = {
  debug: (...a) => emit('debug', ...a),
  info: (...a) => emit('info', ...a),
  warn: (...a) => emit('warn', ...a),
  error: (...a) => emit('error', ...a),
  setLevel: (l) => (currentLevel = LEVELS[l] ?? currentLevel),
};
