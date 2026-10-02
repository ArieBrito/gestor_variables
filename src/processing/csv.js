// Módulo 5: procesamiento de CSV (normalización de columnas, jerarquía padre/hijo,
// duplicados e IDs). Las filas son objetos { columna: valor } con valores string | null.
import { COLUMN_DISPLAY_NAMES, EXPECTED_COLUMNS } from '../constants.js';
import { findBestColumnMatch, normalizeCatalogColumns } from '../catalogs.js';
import { generarSiguienteId, getAllExistingIds } from '../db.js';
import { buildExistingHashes, computeRowHash } from '../hash.js';
import { safeNormalize } from '../normalize.js';
import { predictCategories } from '../ml.js';
import { isNA, removerAcentos } from '../util/py.js';

export const normalizeColForMatching = (c) => removerAcentos(String(c).toLowerCase().replace(/ /g, '_')).replace(/-/g, '_');

const blank = (v) => isNA(v) || String(v).trim() === '';
const str = (v) => (isNA(v) ? '' : String(v).trim());

/** Renombra la clave `from` a `to` conservando el orden de columnas. */
function renameKey(rows, from, to) {
  for (const r of rows) {
    if (!(from in r)) continue;
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k === from ? to : k] = v;
    for (const k of Object.keys(r)) delete r[k];
    Object.assign(r, out);
  }
}

/** _normalize_columns */
function normalizeColumns(rows, cols, messages) {
  const YEAR = ['año', 'ano', 'anio', 'Año', 'AÑO', 'anho'];
  for (const c of cols) {
    const clean = removerAcentos(String(c).toLowerCase().trim().replace(/ /g, '_'));
    if (YEAR.includes(clean) || clean === 'año') {
      if (c !== 'año') {
        renameKey(rows, c, 'año');
        cols[cols.indexOf(c)] = 'año';
        messages.push(`Columna '${c}' renombrada a 'año' por alias.`);
      }
      break;
    }
  }
  const ESTADO = ['entidad', 'estado', 'entidad_federativa', 'estado_federativo'];
  let found = false;
  for (const c of cols) {
    const clean = removerAcentos(String(c).toLowerCase().trim().replace(/ /g, '_'));
    if (ESTADO.includes(clean)) {
      if (c !== 'estado') {
        renameKey(rows, c, 'estado');
        cols[cols.indexOf(c)] = 'estado';
        messages.push(`Columna '${c}' renombrada a 'estado' por alias.`);
      }
      found = true;
      break;
    }
  }
  if (!found) {
    for (const r of rows) r.estado = null;
    cols.push('estado');
    messages.push('No se encontró columna de estado, se crea vacía.');
  }
}

/** _map_columns_to_expected */
function mapColumnsToExpected(rows, cols, messages) {
  const known = new Set(EXPECTED_COLUMNS);
  for (const d of COLUMN_DISPLAY_NAMES) known.add(normalizeColForMatching(d));
  const knownList = [...known];

  const map = {};
  const used = new Set();
  for (const orig of cols) {
    const norm = normalizeColForMatching(orig);
    let target = null;
    if (EXPECTED_COLUMNS.includes(norm)) {
      target = norm;
      if (orig !== target) messages.push(`Columna renombrada: '${orig}' a '${target}' (normalización).`);
    } else {
      const fuzzy = findBestColumnMatch(norm, knownList);
      if (fuzzy && EXPECTED_COLUMNS.includes(fuzzy)) {
        target = fuzzy;
        messages.push(`Columna renombrada: '${orig}' a '${target}' (sugerencia).`);
      }
    }
    if (target) {
      if (!used.has(target)) {
        map[orig] = target;
        used.add(target);
      } else {
        messages.push(`Columna '${orig}' ignorada (ya mapeada a '${target}').`);
        map[orig] = orig;
      }
    } else map[orig] = orig;
  }
  const extra = [];
  const newCols = [];
  for (const c of cols) {
    const n = map[c];
    if (!EXPECTED_COLUMNS.includes(n) && n !== 'id' && !n.startsWith('_') && n !== 'parent_id') extra.push(n);
    else if (!newCols.includes(n)) newCols.push(n);
  }
  for (const r of rows) {
    const out = {};
    for (const c of cols) {
      const n = map[c];
      if (!extra.includes(n) && !(n in out)) out[n] = r[c] ?? null;
    }
    for (const k of Object.keys(r)) delete r[k];
    Object.assign(r, out);
  }
  if (extra.length) messages.push(`Columnas ignoradas: ${extra.join(', ')}`);
  for (const c of EXPECTED_COLUMNS) {
    if (!newCols.includes(c)) {
      for (const r of rows) r[c] = null;
      newCols.push(c);
      messages.push(`Columna añadida (faltante): '${c}'`);
    }
  }
  return newCols;
}

/** _detect_parent_child_from_csv: marca _is_parent/_is_child/_parent_id/parent_id en cada fila. */
function detectParentChild(rows, messages) {
  const explicit = rows.map((r) => str(r.parent_id));
  const nFilled = explicit.filter(Boolean).length;
  messages.push(`🔍 _detect_parent_child_from_csv: parent_id_col_present=${rows.some((r) => 'parent_id' in r)}, filled=${nFilled}/${rows.length}`);

  let method;
  if (nFilled > 0) {
    rows.forEach((r, i) => {
      r._is_parent = explicit[i] === '';
      r._is_child = !r._is_parent;
      r._parent_id = r._is_child ? explicit[i] : null;
    });
    method = 'explicit_parent_id';
  } else {
    rows.forEach((r) => {
      const nombre = str(r.nombre);
      const estado = str(r.estado);
      r._is_parent = nombre.endsWith('- Total') && (estado === '' || estado === 'No aplica');
      r._is_child = !r._is_parent;
      r._parent_id = null;
    });
    method = 'name_heuristic';
  }

  const parentNameToId = new Map();
  for (const r of rows) {
    if (!r._is_parent) continue;
    const name = str(r.nombre);
    const id = str(r.id);
    if (name && id && !parentNameToId.has(name)) parentNameToId.set(name, id);
  }
  let resolved = 0;
  let unresolved = 0;
  for (const r of rows) {
    if (!r._is_child) continue;
    if (r._parent_id) {
      resolved++;
      continue;
    }
    const child = str(r.nombre);
    let bestId = null;
    let bestLen = 0;
    for (const [pname, pid] of parentNameToId) {
      if ((child.startsWith(`${pname} - `) || child === pname) && pname.length > bestLen) {
        bestLen = pname.length;
        bestId = pid;
      }
    }
    if (bestId) {
      r._parent_id = bestId;
      resolved++;
    } else unresolved++;
  }
  for (const r of rows) {
    r.parent_id = r._parent_id;
    r._parent_hash = null;
  }
  const stats = {
    parents: rows.filter((r) => r._is_parent).length,
    children: rows.filter((r) => r._is_child).length,
    children_resolved: resolved,
    children_unresolved: unresolved,
    method,
  };
  messages.push(`🔍 ${stats.parents} padres, ${stats.children} hijos (${resolved} resueltos, ${unresolved} sin padre). Método: ${method}`);
  return stats;
}

/** _predict_categories_vectorized: rellena proceso/eje/tema vacíos a partir del nombre. */
function predictCategoriesFor(rows) {
  const cache = new Map();
  for (const r of rows) {
    if (!['proceso', 'eje', 'tema'].some((c) => blank(r[c]))) continue;
    const name = r.nombre;
    if (blank(name)) continue;
    let pred = cache.get(name);
    if (!pred) {
      pred = predictCategories(String(name));
      cache.set(name, pred);
    }
    ['proceso', 'eje', 'tema'].forEach((c, i) => {
      if (blank(r[c])) r[c] = pred[i];
    });
  }
  for (const r of rows) for (const c of ['proceso', 'eje', 'tema']) if (isNA(r[c])) r[c] = '';
}

/**
 * _process_csv_data
 * @param {Array<Record<string,any>>} inputRows filas (objetos) del CSV
 * @param {string[]} inputCols columnas en su orden original
 * @param {Array<Record<string,any>>} existingData filas existentes en Supabase
 * @param {{assignIds?: boolean}} opts
 * @returns {Promise<{rows: object[], messages: string[]}>}
 */
export async function processCsvData(inputRows, inputCols, existingData, { assignIds = true } = {}) {
  const messages = [];
  const rows = inputRows.map((r) => ({ ...r }));
  const cols = [...inputCols];

  normalizeColumns(rows, cols, messages);
  mapColumnsToExpected(rows, cols, messages);

  for (const r of rows) r._original_csv_id = isNA(r.id) ? '' : String(r.id);
  const stats = detectParentChild(rows, messages);

  const yearMap = new Map();
  for (const r of rows) {
    const v = r['año'];
    if (!yearMap.has(v)) {
      const nv = safeNormalize(v, 'año');
      let out = '';
      if (!isNA(nv) && String(nv).trim() !== '') {
        const n = parseFloat(nv);
        out = Number.isFinite(n) ? String(Math.trunc(n)) : String(nv);
      }
      yearMap.set(v, out);
    }
    r['año'] = yearMap.get(v);
  }

  predictCategoriesFor(rows);
  normalizeCatalogColumns(rows);

  const existingHashes = await buildExistingHashes(existingData, messages);
  for (const r of rows) r._hash = computeRowHash(r);

  const tempIds = new Set(await getAllExistingIds());
  for (const r of rows) {
    r._is_duplicate = existingHashes.has(r._hash);
    r._supabase_matching_id = r._is_duplicate ? existingHashes.get(r._hash).id ?? null : null;
  }
  for (const r of rows) {
    if (!r._is_duplicate && assignIds) {
      const id = await generarSiguienteId(tempIds);
      tempIds.add(id);
      r.id = id;
    } else r.id = blank(r.id) ? null : String(r.id);
  }

  const csvToFinal = new Map();
  for (const r of rows) if (r._original_csv_id && r.id) csvToFinal.set(r._original_csv_id, String(r.id));
  for (const r of rows) {
    const p = str(r._parent_id);
    r._parent_id = p ? csvToFinal.get(p) ?? p : null;
    r.parent_id = r._parent_id;
  }
  const idToHash = new Map();
  for (const r of rows) if (r.id && r._hash) idToHash.set(String(r.id), r._hash);
  for (const r of rows) r._parent_hash = r._parent_id ? idToHash.get(String(r._parent_id)) ?? null : null;

  const out = rows.map((r, idx) => {
    const data = {};
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) data[k] = isNA(v) ? null : v;
    return {
      original_csv_index: idx,
      data,
      _is_duplicate: Boolean(r._is_duplicate),
      _supabase_matching_id: r._supabase_matching_id ?? null,
      _hash: r._hash,
      _is_parent: Boolean(r._is_parent),
      _is_child: Boolean(r._is_child),
      _parent_hash: r._parent_hash,
      _parent_id: r._parent_id,
      _nuevo_en_catalogo: {},
    };
  });
  messages.push(`✅ _process_csv_data: ${stats.parents} padres, ${stats.children} hijos (${stats.children_resolved} resueltos vía nombre/parent_id).`);
  return { rows: out, messages };
}
