// Configuración global: variables de entorno + logger (modo debug).
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const truthy = (v, def = false) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const DEBUG = truthy(process.env.DEBUG, NODE_ENV !== 'production');
export const DISABLE_AUTH = truthy(process.env.DISABLE_AUTH, false);
export const PORT = parseInt(process.env.PORT || process.env.FLASK_PORT || '8000', 10);
export const PORT_SCAN_RANGE = 100;

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
export const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
export const USING_SERVICE_ROLE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
export const NGROK_AUTH_TOKEN = (process.env.NGROK_AUTH_TOKEN || '').trim();
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

// Parámetros de negocio (idénticos al notebook)
export const CACHE_TTL = 60; // segundos
export const UMBRAL_CONFIANZA = 0.92;
export const PREVIEW_EXPIRE_SECONDS = 600;
export const TASK_TTL_COMPLETED = 300;
export const TASK_TTL_HARD = 3600;
export const ZIP_SESSION_TTL = 1800;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export const MODELS_DIR = path.join(ROOT_DIR, 'modelos');
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
