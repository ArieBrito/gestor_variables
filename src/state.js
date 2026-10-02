// Estado en memoria: previsualizaciones, sesiones de ZIP y tareas asíncronas (Módulo 10).
import crypto from 'node:crypto';
import { PREVIEW_EXPIRE_SECONDS, TASK_TTL_COMPLETED, TASK_TTL_HARD, ZIP_SESSION_TTL, logger } from './config.js';

export const uuid = () => crypto.randomUUID();
const nowSec = () => Date.now() / 1000;

// ---- Previsualizaciones ----
export const previewCache = new Map();
export function cleanOldPreviewCache() {
  const now = nowSec();
  for (const [k, v] of previewCache) if (now - v.timestamp > PREVIEW_EXPIRE_SECONDS) previewCache.delete(k);
}

// ---- Sesiones de ZIP (bytes cacheados tras /api/discover-variables) ----
export const zipSessions = new Map();
export function cleanZipSessions() {
  const now = nowSec();
  for (const [k, v] of zipSessions) if (now - (v.timestamp || 0) > ZIP_SESSION_TTL) zipSessions.delete(k);
}

// ---- Tareas asíncronas ----
export const tasks = new Map();

export function cleanOldTasks() {
  const now = nowSec();
  let removed = 0;
  for (const [id, t] of tasks) {
    const age = now - (t.timestamp ?? now);
    if ((['completed', 'error', 'cancelled'].includes(t.status) && age > TASK_TTL_COMPLETED) || age > TASK_TTL_HARD) {
      tasks.delete(id);
      removed++;
    }
  }
  if (removed) logger.info(`🧹 cleanOldTasks: eliminadas ${removed} tasks viejas`);
  return removed;
}

export function createTask(filename) {
  const id = uuid();
  tasks.set(id, { status: 'pending', progress: 0, messages: [], result: null, error: null, filename, cancelled: false, timestamp: nowSec() });
  return id;
}

/** Actualiza solo si la task existe y no fue cancelada. */
export function updateTask(id, progress = null, message = null) {
  const t = tasks.get(id);
  if (!t || t.cancelled) return;
  if (progress !== null) t.progress = Math.min(progress, 100);
  if (message !== null) t.messages.push(message);
}

// Limpieza periódica
setInterval(() => {
  cleanOldPreviewCache();
  cleanZipSessions();
  cleanOldTasks();
}, 60_000).unref();
