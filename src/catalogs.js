// Catálogos y normalización de categorías (Módulos 3-4 del notebook).
import { KEYWORDS } from './constants.js';
import { getCatalogOptions, must, supabase } from './db.js';
import { logger } from './config.js';
import { isNA, removerAcentos, safeClean, sequenceRatio } from './util/py.js';

export const CATALOG_TABLES = ['proceso', 'eje', 'tema', 'cobertura', 'periodicidad', 'estado'];

const _CATALOG_CACHE = {}; // tabla -> { nombre_normalizado: nombre_canónico }
const _KEYWORDS_NORM = {}; // tipo  -> { categoria_normalizada: categoria }

/** Carga los catálogos de Supabase (cobertura, periodicidad, estado) y las keywords. */
export async function loadAllCatalogs() {
  for (const table of ['cobertura', 'periodicidad', 'estado']) {
    try {
      const { data } = await must(supabase.from(table).select('name'));
      const map = {};
      for (const r of data || []) {
        if (r.name) map[removerAcentos(String(r.name).toLowerCase().trim())] = r.name;
      }
      _CATALOG_CACHE[table] = map;
    } catch (e) {
      logger.warn(`No se pudo cargar catálogo ${table}: ${e.message}`);
      _CATALOG_CACHE[table] = {};
    }
  }
  for (const [key, categories] of Object.entries(KEYWORDS)) {
    const map = {};
    for (const cat of Object.keys(categories)) map[removerAcentos(cat.toLowerCase().trim())] = cat;
    _KEYWORDS_NORM[key] = map;
  }
}

// ---------------------------------------------------------------------------
// Coincidencias difusas
// ---------------------------------------------------------------------------
export const normalizeColForMatching = (colName) =>
  removerAcentos(String(colName).toLowerCase().replace(/ /g, '_')).replace(/-/g, '_');

/** _find_best_column_match */
export function findBestColumnMatch(uploadedColNormalized, availableExpectedNormalized, threshold = 0.8) {
  let best = null;
  let highest = threshold;
  for (const exp of availableExpectedNormalized) {
    const score = sequenceRatio(uploadedColNormalized, exp);
    if (score > highest) {
      highest = score;
      best = exp;
    }
  }
  return best;
}

/** _find_best_value_match -> [mejor, score] */
export function findBestValueMatch(inputValue, availableOptions, threshold = 0.8) {
  if (!inputValue || !availableOptions || !availableOptions.length) return [null, 0.0];
  const inputNorm = removerAcentos(String(inputValue).toLowerCase());
  let best = null;
  let highest = 0.0;
  for (const opt of availableOptions) {
    const score = sequenceRatio(inputNorm, removerAcentos(String(opt).toLowerCase()));
    if (score > highest) {
      highest = score;
      best = opt;
    }
  }
  return highest >= threshold ? [best, highest] : [null, highest];
}

/** normalizar_categoria: valor -> [valorNormalizado, fueNormalizado] */
export function normalizarCategoria(valor, tipo, debug = false, threshold = 0.8) {
  if (!valor) return [valor, false];
  const limpio = safeClean(valor);
  if (!limpio) return [valor, false];
  if (!['proceso', 'eje', 'tema'].includes(tipo)) return [valor, false];

  const palabrasPorOpcion = KEYWORDS[tipo];
  const opciones = Object.keys(palabrasPorOpcion);
  const valorNorm = removerAcentos(limpio.toLowerCase().trim());

  for (const opt of opciones) {
    if (removerAcentos(opt.toLowerCase().trim()) === valorNorm) {
      if (debug) logger.debug(`✅ Normalizado ${tipo}: '${valor}' -> '${opt}'`);
      return [opt, true];
    }
  }

  const textoNorm = removerAcentos(limpio.toLowerCase());
  for (const [categoria, palabras] of Object.entries(palabrasPorOpcion)) {
    if (palabras.some((p) => textoNorm.includes(removerAcentos(p.toLowerCase())))) {
      if (debug) logger.debug(`✅ Normalizado ${tipo} por keyword: '${valor}' -> '${categoria}'`);
      return [categoria, true];
    }
  }

  let best = null;
  let bestScore = 0.0;
  for (const opt of opciones) {
    const score = sequenceRatio(removerAcentos(limpio.toLowerCase()), removerAcentos(opt.toLowerCase()));
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  if (bestScore >= threshold) {
    if (debug) logger.debug(`⚠️ Normalizado ${tipo} (difuso): '${valor}' -> '${best}' (score ${bestScore.toFixed(2)})`);
    return [best, true];
  }
  if (debug) logger.debug(`❌ No se pudo normalizar ${tipo}: '${valor}'`);
  return [valor, false];
}

/**
 * normalize_catalog_columns_vectorized: normaliza (en el lugar) las columnas de catálogo
 * de un arreglo de filas usando los mapas precargados (sin consultas a Supabase).
 * @param {Array<Record<string,any>>} rows
 */
export function normalizeCatalogColumns(rows) {
  if (!rows || !rows.length) return rows;

  const hasCol = (col) => rows.some((r) => Object.prototype.hasOwnProperty.call(r, col));

  // 1. Catálogos de texto
  for (const col of ['cobertura', 'periodicidad', 'estado']) {
    if (!hasCol(col)) continue;
    const catalogMap = _CATALOG_CACHE[col] || {};
    if (!Object.keys(catalogMap).length) continue;
    const cache = new Map();
    for (const r of rows) {
      const v = r[col];
      if (isNA(v) || !String(v).trim()) continue;
      let mapped = cache.get(v);
      if (mapped === undefined) {
        const key = removerAcentos(String(v).toLowerCase().trim());
        mapped = Object.prototype.hasOwnProperty.call(catalogMap, key) ? catalogMap[key] : v;
        cache.set(v, mapped);
      }
      r[col] = mapped;
    }
  }

  // 2. Categorías (proceso, eje, tema) con KEYWORDS
  for (const col of ['proceso', 'eje', 'tema']) {
    if (!hasCol(col)) continue;
    const catMap = _KEYWORDS_NORM[col] || {};
    if (!Object.keys(catMap).length) continue;
    const cache = new Map();
    for (const r of rows) {
      const v = r[col];
      if (isNA(v) || !String(v).trim()) continue;
      let mapped = cache.get(v);
      if (mapped === undefined) {
        const key = removerAcentos(String(v).toLowerCase().trim());
        if (Object.prototype.hasOwnProperty.call(catMap, key)) mapped = catMap[key];
        else {
          mapped = v;
          outer: for (const [cat, palabras] of Object.entries(KEYWORDS[col])) {
            for (const p of palabras) {
              if (key.includes(removerAcentos(p.toLowerCase()))) {
                mapped = cat;
                break outer;
              }
            }
          }
        }
        cache.set(v, mapped);
      }
      r[col] = mapped;
    }
  }
  return rows;
}

export { getCatalogOptions };
