// Capa de datos: cliente Supabase, cachés y generación de IDs (Módulo 3 del notebook).
import { createClient } from '@supabase/supabase-js';
import { CACHE_TTL, SUPABASE_KEY, SUPABASE_URL, USING_SERVICE_ROLE, logger } from './config.js';
import { normalizarNumeroTexto } from './normalize.js';
import { safeClean } from './util/py.js';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('❌ Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_KEY) en .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
logger.info(`✅ Cliente Supabase inicializado (${USING_SERVICE_ROLE ? 'service_role' : 'anon/publishable'}) → ${SUPABASE_URL}`);

/**
 * Espera una consulta de supabase-js y LANZA si hay error (semántica de postgrest-py .execute()).
 * Devuelve { data, count }.
 */
export async function must(query) {
  const res = await query;
  if (res.error) {
    const e = new Error(res.error.message || String(res.error));
    e.code = res.error.code;
    e.details = res.error.details;
    e.hint = res.error.hint;
    e.status = res.status;
    throw e;
  }
  return { data: res.data, count: res.count ?? null };
}

/**
 * Trae TODAS las filas paginando (PostgREST limita a 1000 por petición).
 * @param {(from:number,to:number)=>any} build función que recibe el rango y devuelve el query builder
 */
export async function fetchAll(build, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await must(build(from, from + pageSize - 1));
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

/** Divide un arreglo en trozos. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Cachés de la tabla 'variables'
// ---------------------------------------------------------------------------
let _existingDataCache = null;
let _existingIdsCache = null;
let _cacheTimestamp = 0;
let _maxIdCache = null;
let _maxIdInit = null;

export async function refreshCaches(force = false) {
  const now = Date.now() / 1000;
  if (!force && _existingDataCache !== null && now - _cacheTimestamp < CACHE_TTL) return;
  try {
    const rows = await fetchAll((a, b) => supabase.from('variables').select('*').order('id').range(a, b));
    _existingDataCache = rows;
    _existingIdsCache = new Set(rows.map((r) => String(r.id)));
    _cacheTimestamp = now;
    logger.debug(`🗄️ caché de variables refrescada: ${rows.length} filas`);
  } catch (e) {
    logger.error(`Error al refrescar caches: ${e.message}`);
    _existingDataCache = [];
    _existingIdsCache = new Set();
    _cacheTimestamp = 0;
  }
}

export async function getAllExistingIds() {
  if (_existingIdsCache === null) await refreshCaches();
  return _existingIdsCache || new Set();
}

/** Todas las variables, normalizadas (texto limpio; año/valor normalizados). */
export async function getAllVariablesData() {
  if (_existingDataCache === null) await refreshCaches();
  if (!_existingDataCache || !_existingDataCache.length) return [];
  return _existingDataCache.map((item) => {
    const row = {};
    for (const [k, vRaw] of Object.entries(item)) {
      let v = vRaw;
      if (k === 'año' || k === 'valor') v = normalizarNumeroTexto(v, k);
      row[k] = safeClean(v);
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Generación de IDs 'A-00001'
// ---------------------------------------------------------------------------
export function resetMaxIdCache() {
  _maxIdCache = null;
  logger.info('🔢 _MAX_ID_CACHE invalidado (se recalculará en la próxima generación).');
}

async function initMaxId() {
  try {
    const rows = await fetchAll((a, b) => supabase.from('variables').select('id').order('id').range(a, b));
    let max = 0;
    let n = 0;
    for (const r of rows) {
      const m = /A-(\d+)/.exec(r.id || '');
      if (r.id && String(r.id).startsWith('A-') && m) {
        n++;
        max = Math.max(max, parseInt(m[1], 10));
      }
    }
    _maxIdCache = max;
    logger.info(`🔢 _MAX_ID_CACHE inicializado en ${max} (${n} IDs 'A-*' encontrados)`);
  } catch (e) {
    logger.error(`❌ No se pudo consultar el max ID en Supabase: ${e.message}. SE ABORTA la generación de IDs.`);
    throw new Error('No se pudo determinar el siguiente ID: Supabase no responde o rechazó la consulta. Reintenta cuando haya conexión estable.');
  }
}

/** Siguiente ID único 'A-XXXXX' (seguro ante llamadas concurrentes). */
export async function generarSiguienteId(usedIds = null) {
  if (_maxIdCache === null) {
    _maxIdInit = _maxIdInit || initMaxId().finally(() => (_maxIdInit = null));
    await _maxIdInit;
  }
  let num = _maxIdCache + 1;
  let id = `A-${String(num).padStart(5, '0')}`;
  while (usedIds && usedIds.has(id)) {
    num++;
    id = `A-${String(num).padStart(5, '0')}`;
  }
  _maxIdCache = num;
  return id;
}

// ---------------------------------------------------------------------------
// Catálogos (tablas con columna 'name')
// ---------------------------------------------------------------------------
const _catalogCache = new Map();

export function invalidateCatalogCache(table) {
  if (table) _catalogCache.delete(table);
  else _catalogCache.clear();
}

export function setCatalogCache(table, options) {
  _catalogCache.set(table, options);
}

export function getCachedCatalog(table) {
  return _catalogCache.get(table);
}

/** Opciones (ordenadas, únicas) de una tabla de catálogo, con caché. */
export async function getCatalogOptions(table) {
  if (_catalogCache.has(table)) return _catalogCache.get(table);
  try {
    const { data } = await must(supabase.from(table).select('name'));
    const options = [...new Set((data || []).map((r) => r.name).filter(Boolean))].sort();
    _catalogCache.set(table, options);
    return options;
  } catch (e) {
    logger.error(`Error al obtener opciones para '${table}': ${e.message}`);
    return [];
  }
}
