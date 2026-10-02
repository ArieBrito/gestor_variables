// Módulo 10 (persistencia): aplicación de acciones por lote (padres primero, luego hijos),
// upsert robusto con reintentos y borrado por trozos.
import { EXPECTED_COLUMNS, KEYWORDS } from './constants.js';
import { logger } from './config.js';
import { chunk, fetchAll, generarSiguienteId, getAllExistingIds, getAllVariablesData, must, refreshCaches, supabase } from './db.js';
import { computeRowHash } from './hash.js';
import { normalizarCategoria } from './catalogs.js';
import { normalizarNumeroTexto } from './normalize.js';
import { predictCategories } from './ml.js';

const TABLE_COLS = new Set([...EXPECTED_COLUMNS, 'parent_id', 'institucion']);
const firstKey = (tipo) => Object.keys(KEYWORDS[tipo])[0];
const empty = (v) => v === null || v === undefined || v === '';

/** Deja solo columnas que existen en la tabla (descarta '_hash', etc.). */
const toTableRow = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => TABLE_COLS.has(k)));

/** rellenar_categorias */
export function rellenarCategorias(row, debug = [], force = false) {
  for (const col of ['año', 'valor']) {
    if (!empty(row[col])) {
      row[col] = normalizarNumeroTexto(row[col], col);
      if (force) debug.push(`🔢 Normalizado ${col}: ${row[col]}`);
    }
  }
  let nombre = row.nombre;
  if (!nombre || String(nombre).trim() === '') {
    nombre = row.fuente || `Variable ${row.id ?? 'sin_id'}`;
    row.nombre = nombre;
    if (force) debug.push(`⚠️ Nombre vacío, se usó '${nombre}'`);
  }
  if (!force && row.proceso && row.eje && row.tema) {
    if (row.proceso in KEYWORDS.proceso && row.eje in KEYWORDS.eje && row.tema in KEYWORDS.tema) return row;
  }
  if (!row.proceso || !row.eje || !row.tema) {
    const [proc, eje, tema] = predictCategories(nombre);
    if (proc && !row.proceso) row.proceso = proc;
    if (eje && !row.eje) row.eje = eje;
    if (tema && !row.tema) row.tema = tema;
  }
  if (!row.proceso) row.proceso = firstKey('proceso');
  if (!row.eje) row.eje = firstKey('eje');
  if (!row.tema) row.tema = firstKey('tema');
  for (const col of ['proceso', 'eje', 'tema']) {
    if (row[col]) {
      const original = row[col];
      const [norm] = normalizarCategoria(original, col, force);
      if (norm !== original) {
        row[col] = norm;
        if (force) debug.push(`🔁 Normalizado ${col}: '${original}' -> '${norm}'`);
      }
    }
  }
  if (force) debug.push(`📌 Datos finales: proceso='${row.proceso}', eje='${row.eje}', tema='${row.tema}'`);
  return row;
}

// ---------------------------------------------------------------------------
// Upsert por lotes
// ---------------------------------------------------------------------------
const TRANSIENT = ['timeout', 'timed out', 'connection', 'unavailable', 'reset', 'broken pipe', 'eof', 'server error', 'temporarily', 'fetch failed'];
const isTransient = (e) => TRANSIENT.some((h) => String(e?.message ?? e).toLowerCase().includes(h));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertOne(batch, idx, total, debug, maxRetries) {
  let last;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await must(supabase.from('variables').upsert(batch, { onConflict: 'id' }).select());
      debug.push(`✅ Lote ${idx + 1}/${total} ${attempt > 1 ? `OK en intento ${attempt}/${maxRetries}` : `completado (${batch.length} filas)`}.`);
      return data || [];
    } catch (e) {
      last = e;
      if (attempt < maxRetries && isTransient(e)) {
        const wait = 2 ** attempt;
        debug.push(`⚠️ Lote ${idx + 1}/${total} intento ${attempt}/${maxRetries} falló (${e.message}). Reintentando en ${wait}s...`);
        await sleep(wait * 1000);
      } else {
        debug.push(`❌ Lote ${idx + 1}/${total} falló (intento ${attempt}/${maxRetries}, transitorio=${isTransient(e)}): ${e.message}`);
        break;
      }
    }
  }
  const msg = String(last?.message ?? '');
  if ((msg.toLowerCase().includes('timeout') || msg.includes('57014')) && batch.length > 100) {
    debug.push(`⚠️ Lote ${idx + 1}/${total} timeout persistente. Dividiendo en sub-lotes de 100.`);
    const out = [];
    for (const [i, sub] of chunk(batch, 100).entries()) {
      const { data } = await must(supabase.from('variables').upsert(sub, { onConflict: 'id' }).select());
      out.push(...(data || []));
      debug.push(`   ✅ Sub-lote ${i + 1} completado (${sub.length} filas).`);
    }
    return out;
  }
  throw new Error(`Lote ${idx + 1}/${total} falló tras ${maxRetries} intentos: ${last?.message}`);
}

/** _upsert_batches -> [insertadas, actualizadas] */
export async function upsertBatches(rows, existingIds, debug, maxRetries = 3) {
  if (!rows.length) {
    debug.push('📦 _upsert_batches: no hay filas para insertar/actualizar.');
    return [[], []];
  }
  const BATCH = 750;
  const WORKERS = 4;
  const batches = chunk(rows, BATCH);
  debug.push(`📦 _upsert_batches: ${batches.length} lote(s) de hasta ${BATCH} filas (max_retries=${maxRetries}, workers=${WORKERS}).`);
  const results = new Array(batches.length);
  const failed = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      try {
        results[i] = await upsertOne(batches[i], i, batches.length, debug, maxRetries);
      } catch (e) {
        failed.push([i, e.message]);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, batches.length) }, worker));

  if (failed.length) {
    failed.sort((a, b) => a[0] - b[0]);
    const summary = failed.slice(0, 3).map(([i, m]) => `lote ${i + 1}: ${m}`).join('; ') + (failed.length > 3 ? `; ... y ${failed.length - 3} más` : '');
    debug.push(`❌ _upsert_batches: fallaron ${failed.length}/${batches.length} lotes. Detalles: ${summary}`);
    throw new Error(`Upsert falló en ${failed.length}/${batches.length} lotes. Los datos NO se guardaron por completo. Detalles: ${summary}`);
  }
  const inserted = [];
  const updated = [];
  for (const res of results) {
    for (const row of res || []) {
      if (existingIds.has(row.id)) updated.push(row);
      else {
        inserted.push(row);
        if (row.id != null) existingIds.add(row.id);
      }
    }
  }
  debug.push(`💾 _upsert_batches finalizado: ${inserted.length} insertadas, ${updated.length} actualizadas.`);
  return [inserted, updated];
}

// ---------------------------------------------------------------------------
// Aplicación de acciones
// ---------------------------------------------------------------------------
async function processParents(parents, usedIds, debug) {
  const rows = [];
  const idMap = new Map();
  debug.push(`🔍 Procesando ${parents.length} padres...`);
  for (const a of parents) {
    const type = a.action || 'insert';
    let row = toTableRow({ ...a.data });
    row.parent_id = null;
    row = rellenarCategorias(row, debug, false);
    if (type === 'insert') {
      if (!row.id) {
        row.id = await generarSiguienteId(usedIds);
        usedIds.add(row.id);
      }
      rows.push(row);
      idMap.set(a._hash, row.id);
      debug.push(`   ➕ Padre insertado: ${row.id} - ${row.nombre ?? ''}`);
    } else if (type === 'overwrite' && a._supabase_matching_id) {
      row.id = a._supabase_matching_id;
      rows.push(row);
      idMap.set(a._hash, row.id);
      debug.push(`   ♻️ Padre actualizado: ${row.id} - ${row.nombre ?? ''}`);
    } else debug.push(`   ⚠️ Padre ignorado (acción '${type}'): ${a._hash}`);
  }
  return [rows, idMap];
}

async function processChildren(children, parentIdMap, existingParentByHash, usedIds, debug) {
  const rows = [];
  debug.push(`🔍 Procesando ${children.length} hijos...`);
  for (const a of children) {
    const type = a.action || 'insert';
    let row = toTableRow({ ...a.data });
    let parentId = null;
    if (a._parent_id != null) parentId = a._parent_id;
    else if (a._parent_hash && parentIdMap.has(a._parent_hash)) parentId = parentIdMap.get(a._parent_hash);
    else if (a._parent_hash && existingParentByHash.has(a._parent_hash)) parentId = existingParentByHash.get(a._parent_hash);
    if (parentId === null) debug.push(`   ⚠️ No se encontró padre para hijo (hash: ${a._parent_hash})`);
    row.parent_id = parentId;
    row = rellenarCategorias(row, debug, false);
    if (type === 'insert') {
      if (!row.id) {
        row.id = await generarSiguienteId(usedIds);
        usedIds.add(row.id);
      }
      rows.push(row);
    } else if (type === 'overwrite' && a._supabase_matching_id) {
      row.id = a._supabase_matching_id;
      rows.push(row);
    } else debug.push(`   ⚠️ Hijo ignorado (acción '${type}'): ${a._hash}`);
  }
  return rows;
}

/** _apply_batch_actions -> { inserted, updated, insertedRows, updatedRows } */
export async function applyBatchActions(actions, debug = []) {
  const t0 = Date.now();
  logger.info(`🔄 Aplicando batch actions: ${actions.length} acciones`);
  debug.push(`🔄 Recibidas ${actions.length} acciones.`);

  await refreshCaches(true);
  const existingIds = await getAllExistingIds();
  const usedIds = new Set(existingIds);
  const existing = await getAllVariablesData();

  const existingParentByHash = new Map();
  const existingParentById = new Map();
  for (const row of existing) {
    if (!row.parent_id) {
      existingParentByHash.set(computeRowHash(row), row.id);
      existingParentById.set(row.id, row);
    }
  }
  debug.push(`📊 IDs existentes: ${existingIds.size}; padres existentes: ${existingParentById.size}.`);

  const parents = actions.filter((a) => a._is_parent);
  const children = actions.filter((a) => !a._is_parent);
  debug.push(`👨‍👧 Padres: ${parents.length}, Hijos: ${children.length}`);

  // Crear padres automáticos solo para hijos huérfanos
  const batchParentHashes = new Set(parents.map((p) => p._hash).filter((h) => h != null));
  const orphans = children.filter((c) => {
    if (c._parent_hash != null && batchParentHashes.has(c._parent_hash)) return false;
    if (c._parent_id != null && !existingParentById.has(c._parent_id)) return true;
    return c._parent_hash != null && !existingParentByHash.has(c._parent_hash);
  });
  if (orphans.length) {
    debug.push(`🔧 ${orphans.length} hijos sin padre existente. Creando padres...`);
    for (const child of orphans) {
      const d = child.data;
      let pid = child._parent_id;
      if (!pid) {
        pid = await generarSiguienteId(usedIds);
        usedIds.add(pid);
      }
      const parentRow = rellenarCategorias(
        {
          id: pid, proceso: d.proceso ?? '', eje: d.eje ?? '', tema: d.tema ?? '', nombre: d.nombre ?? '',
          cobertura: d.cobertura ?? '', periodicidad: d.periodicidad ?? '', liga_web: d.liga_web ?? '',
          fuente: d.fuente ?? '', año: d.año ?? '', estado: 'No aplica', valor: 0, parent_id: null,
        },
        debug,
        false
      );
      const pa = {
        action: 'insert', data: parentRow, _is_parent: true, _hash: computeRowHash(parentRow),
        _supabase_matching_id: null, _parent_id: null, _parent_hash: null, _is_duplicate: false,
      };
      parents.push(pa);
      if (child._parent_id == null) child._parent_id = pid;
      if (child._parent_hash == null) child._parent_hash = pa._hash;
    }
  }

  const [parentRows, parentIdMap] = await processParents(parents, usedIds, debug);
  const childRows = await processChildren(children, parentIdMap, existingParentByHash, usedIds, debug);

  // FASE 1: padres; FASE 2: hijos (las FK exigen que el padre exista)
  const [insP, updP] = parentRows.length ? await upsertBatches(parentRows, existingIds, debug) : [[], []];
  const [insC, updC] = childRows.length ? await upsertBatches(childRows, existingIds, debug) : [[], []];

  await refreshCaches(true);
  const insertedRows = [...insP, ...insC];
  const updatedRows = [...updP, ...updC];
  debug.push(`📊 Resumen: ${insertedRows.length} insertados, ${updatedRows.length} actualizados.`);
  logger.info(`✅ applyBatchActions completado en ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  return { inserted: insertedRows.length, updated: updatedRows.length, insertedRows, updatedRows };
}

// ---------------------------------------------------------------------------
// Borrado robusto (evita statement_timeout 57014)
// ---------------------------------------------------------------------------
export async function fetchAllIds(pageSize = 1000) {
  const rows = await fetchAll((a, b) => supabase.from('variables').select('id').order('id').range(a, b), pageSize);
  return rows.map((r) => r.id).filter(Boolean);
}

export async function chunkedDeleteByIds(ids, chunkSize = 300) {
  let total = 0;
  const pending = chunk(ids, chunkSize);
  let guard = 0;
  while (pending.length && guard++ < 5000) {
    const part = pending.shift();
    if (!part.length) continue;
    try {
      const { data } = await must(supabase.from('variables').delete().in('id', part).select('id'));
      total += data?.length || 0;
      logger.debug(`🗑️ chunk OK (${part.length} ids → ${data?.length || 0} borrados). Acumulado: ${total}`);
    } catch (e) {
      if (/57014|timeout/i.test(e.message) && part.length > 1) {
        const mid = Math.max(1, Math.floor(part.length / 2));
        pending.unshift(part.slice(0, mid), part.slice(mid));
        logger.warn(`⚠️ timeout en chunk de ${part.length}; dividiendo y reintentando.`);
      } else logger.error(`❌ chunk falló definitivamente (${part.length} ids): ${e.message}`);
    }
  }
  return total;
}
