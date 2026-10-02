// Hash de filas (Módulo 6 del notebook): detección de duplicados.
import { EXPECTED_COLUMNS } from './constants.js';
import { normalizarNumeroTexto } from './normalize.js';
import { normalizeCatalogColumns } from './catalogs.js';
import { getAllVariablesData } from './db.js';
import { isNA } from './util/py.js';

export const HASH_SEP = '\x1f'; // ASCII Unit Separator
const HASH_COLS = EXPECTED_COLUMNS.filter((c) => c !== 'id');

/** compute_row_hash_single: mismo string para la misma fila sin importar el origen. */
export function computeRowHash(row) {
  const parts = new Array(HASH_COLS.length);
  for (let i = 0; i < HASH_COLS.length; i++) {
    const c = HASH_COLS[i];
    let v = row[c];
    if (c === 'año' || c === 'valor') v = normalizarNumeroTexto(v, c);
    if (isNA(v)) v = '';
    parts[i] = String(v);
  }
  return parts.join(HASH_SEP);
}

/**
 * build_existing_hashes_vectorized: { hash -> fila existente } (la primera gana).
 * @param {Array<Record<string,any>>|null} existingData filas de 'variables' (si es null se leen de la caché)
 */
export async function buildExistingHashes(existingData = null, log = []) {
  const data = existingData ?? (await getAllVariablesData());
  const map = new Map();
  if (!data || !data.length) return map;
  const rows = normalizeCatalogColumns(data.map((r) => ({ ...r })));
  for (const r of rows) {
    const h = computeRowHash(r);
    if (!map.has(h)) map.set(h, r);
  }
  log.push(`📦 Hashes existentes construidos: ${map.size} únicos.`);
  return map;
}
