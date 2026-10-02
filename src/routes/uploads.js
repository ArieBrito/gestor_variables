// Rutas de carga: CSV, ZIP (discover / process / confirm), tareas y previsualización.
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { applyBatchActions } from '../batch.js';
import { findBestValueMatch } from '../catalogs.js';
import { EXPECTED_COLUMNS, KEYWORDS } from '../constants.js';
import { MAX_UPLOAD_BYTES, logger } from '../config.js';
import { getAllVariablesData, getCatalogOptions, must, refreshCaches, supabase } from '../db.js';
import { processCsvData, normalizeColForMatching } from '../processing/csv.js';
import { detectFormatAndPaths, discoverVariables, extractAndFindFolders, loadIndexDescriptions, processZipFile } from '../processing/folder.js';
import { apiAuth } from '../auth.js';
import { cleanForJson } from '../util/py.js';
import { readCsv } from '../util/frame.js';
import { cleanOldTasks, cleanZipSessions, createTask, previewCache, tasks, updateTask, uuid, zipSessions } from '../state.js';
import { fail, priorityKey } from './util.js';

export const router = Router();
router.use('/api', apiAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const nowSec = () => Date.now() / 1000;
const recordHistory = async (archivo, inserted, updated) => {
  try {
    await must(
      supabase.from('cargas').insert({
        fecha: new Date().toISOString(), archivo, filas_agregadas: inserted, estado: inserted > 0 || updated > 0 ? 'completado' : 'error',
      })
    );
  } catch (e) {
    logger.warn(`Error al guardar historial: ${e.message}`);
  }
};
const tokenEntry = (token) => (token && previewCache.has(token) ? previewCache.get(token) : null);

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
router.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se encontró el archivo' });
    if (!file.originalname.toLowerCase().endsWith('.csv')) return res.status(400).json({ error: 'Archivo inválido. Debe ser CSV.' });

    // Modo confirmación: se aplican las acciones elegidas por el usuario
    if (req.query.preview !== 'true') {
      const actions = JSON.parse(req.body.actions_for_rows || '[]');
      const debug = [];
      const { inserted, updated, insertedRows, updatedRows } = await applyBatchActions(actions, debug);
      await recordHistory(file.originalname, inserted, updated);
      let msg = `Se insertaron ${inserted} filas nuevas.`;
      if (updated > 0) msg += ` Se actualizaron ${updated} filas existentes.`;
      return res.json({ status: 'ok', message: msg, debug, inserted: cleanForJson(insertedRows), updated: cleanForJson(updatedRows) });
    }

    const messages = [];
    let frame;
    try {
      frame = readCsv(file.buffer, { lower: false });
      messages.push('CSV procesado correctamente.');
    } catch (e) {
      throw new Error(`Error al leer el CSV: ${e.message}`);
    }
    logger.debug(`📋 Columnas leídas del CSV: ${JSON.stringify(frame.columns)}`);

    // Alias de año y columnas esperadas / parent_id
    const colMap = {};
    const YEAR = ['año', 'ano', 'anio'];
    let yearFound = false;
    for (const c of frame.columns) {
      const clean = normalizeColForMatching(String(c).trim());
      if (!yearFound && (YEAR.includes(clean) || clean === 'año')) {
        yearFound = true;
        colMap[c] = 'año';
        if (c !== 'año') messages.push(`Columna '${c}' renombrada a 'año' por alias.`);
        continue;
      }
      if (EXPECTED_COLUMNS.includes(clean)) colMap[c] = clean;
      else if (['parent_id', 'parentid', 'parent', 'padre', 'id_padre', 'padre_id'].includes(clean)) colMap[c] = 'parent_id';
      else colMap[c] = c;
    }
    const cols = [];
    for (const c of frame.columns) if (!cols.includes(colMap[c])) cols.push(colMap[c]);
    const rows = [];
    for (let i = 0; i < frame.length; i++) {
      const r = {};
      for (const c of frame.columns) if (!(colMap[c] in r)) r[colMap[c]] = frame.data[c][i];
      rows.push(r);
    }
    if (!yearFound) {
      messages.push('⚠️ No se encontró columna de año. Se dejará vacía.');
      rows.forEach((r) => (r['año'] = null));
      cols.push('año');
    }
    if (!cols.includes('parent_id')) {
      rows.forEach((r) => (r.parent_id = null));
      cols.push('parent_id');
    }

    await refreshCaches(true);
    const existing = await getAllVariablesData();
    const { rows: processed, messages: pm } = await processCsvData(rows, cols, existing);
    messages.push(...pm);

    for (const info of processed) {
      const nuevo = {};
      for (const col of ['proceso', 'eje', 'tema', 'cobertura', 'periodicidad', 'estado']) {
        const v = info.data[col] ? String(info.data[col]).trim() : '';
        if (!v) continue;
        const options = ['proceso', 'eje', 'tema'].includes(col) ? Object.keys(KEYWORDS[col]) : await getCatalogOptions(col);
        const [match] = findBestValueMatch(v, options, 1.0);
        if (match === null) nuevo[col] = true;
      }
      info._nuevo_en_catalogo = nuevo;
    }
    processed.sort((a, b) => priorityKey(a) - priorityKey(b));
    return res.json({ status: 'preview', messages, preview_data: cleanForJson(processed) });
  } catch (e) {
    return fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------
const isZip = (f) => f && f.originalname && f.originalname.toLowerCase().endsWith('.zip');

/** Versión síncrona: genera la previsualización completa (el frontend usa la asíncrona). */
router.post('/api/process-folder', upload.single('file'), async (req, res) => {
  const log = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No se encontró el archivo ZIP' });
    if (!isZip(req.file)) return res.status(400).json({ error: 'El archivo debe ser un ZIP' });
    const { finalRows, meta, rowStatus, previewToken } = await processZipFile(req.file.buffer, req.file.originalname, log);
    if (!finalRows.length) {
      log.push('⚠️ No se generaron filas a partir de los archivos. Verifica que los CSV tengan columnas de totales y que el diccionario esté bien formado.');
      return res.json({ status: 'preview', messages: log, preview_data: [], global_metadata: {}, zip_filename: req.file.originalname, total_rows: 0, preview_token: null });
    }

    await refreshCaches(true);
    const existing = await getAllVariablesData();
    const cols = [...EXPECTED_COLUMNS];
    const flatInput = finalRows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    const { rows: flat, messages: dm } = await processCsvData(flatInput, cols, existing, { assignIds: false });
    log.push(...dm);
    const hashMap = new Map();
    for (const f of flat) if (f._hash) hashMap.set(f._hash, f);
    for (const st of rowStatus) {
      const f = st._hash ? hashMap.get(st._hash) : null;
      st._is_duplicate = f ? f._is_duplicate : false;
      st._supabase_matching_id = f ? f._supabase_matching_id : null;
      st._nuevo_en_catalogo = f ? f._nuevo_en_catalogo : {};
    }
    rowStatus.sort((a, b) => priorityKey(a) - priorityKey(b));
    const entry = previewCache.get(previewToken);
    if (entry) entry.processed_rows = rowStatus;
    return res.json({
      status: 'preview', messages: cleanForJson(log), preview_data: cleanForJson(rowStatus), global_metadata: cleanForJson(meta),
      zip_filename: req.file.originalname, preview_token: previewToken, total_rows: rowStatus.length, page: 1, page_size: rowStatus.length,
    });
  } catch (e) {
    return fail(res, e, 500, { messages: log });
  }
});

router.post('/api/discover-variables', upload.single('file'), async (req, res) => {
  const log = [];
  let tmpdir = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No se encontró el archivo ZIP' });
    if (!isZip(req.file)) return res.status(400).json({ error: 'El archivo debe ser un ZIP' });
    const folders = extractAndFindFolders(req.file.buffer, log);
    tmpdir = folders.tmpdir;
    const p = detectFormatAndPaths(folders, log);
    const indice = loadIndexDescriptions(p.dataDir, p.newFormat, p.indiceFilename, log);
    const discovery = discoverVariables(p.dictDir, p.dataDir, p.catDir, p.newFormat, indice, log);
    const sessionId = uuid();
    zipSessions.set(sessionId, { bytes: req.file.buffer, filename: req.file.originalname, timestamp: nowSec() });
    cleanZipSessions();
    return res.json({ status: 'ok', session_id: sessionId, discovery, log });
  } catch (e) {
    logger.error(`Error en discover-variables: ${e.stack}`);
    return res.status(500).json({ error: e.message, log });
  } finally {
    if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

router.post('/api/process-folder-async', upload.single('file'), async (req, res) => {
  let sel = null;
  const selJson = String(req.body?.selected_variables || '').trim();
  if (selJson) {
    try {
      sel = new Set();
      for (const item of JSON.parse(selJson)) if (item.data_file && item.column) sel.add(`${item.data_file}\u0000${item.column}`);
      logger.info(`🔎 process_folder_async: ${sel.size} variables seleccionadas`);
    } catch (e) {
      return res.status(400).json({ error: `selected_variables inválido: ${e.message}` });
    }
  }

  let zipBytes;
  let filename;
  const sessionId = String(req.body?.session_id || '').trim();
  if (sessionId) {
    const sess = zipSessions.get(sessionId);
    if (!sess) return res.status(404).json({ error: 'Sesión expirada. Vuelve a subir el ZIP.' });
    ({ bytes: zipBytes, filename } = sess);
  } else {
    if (!req.file) return res.status(400).json({ error: 'No se encontró el archivo ZIP' });
    if (!isZip(req.file)) return res.status(400).json({ error: 'El archivo debe ser un ZIP' });
    zipBytes = req.file.buffer;
    filename = req.file.originalname;
  }

  cleanOldTasks();
  const taskId = createTask(filename);
  const task = tasks.get(taskId);

  // Tarea en segundo plano (el procesamiento cede el control al event loop entre archivos)
  (async () => {
    const log = [];
    try {
      Object.assign(task, { status: 'running', progress: 10, timestamp: nowSec() });
      const { finalRows, meta, rowStatus, totalParents, previewToken } = await processZipFile(zipBytes, filename, log, {
        sel, onProgress: (p, msg) => updateTask(taskId, p, msg),
      });
      if (task.cancelled) {
        logger.info(`🛑 task ${taskId} cancelada`);
        Object.assign(task, { status: 'cancelled', messages: log });
        return;
      }
      if (!finalRows.length || !rowStatus.length) {
        log.push('⚠️ No se generaron filas a partir de los archivos.');
        Object.assign(task, {
          status: 'completed', progress: 100, messages: log, timestamp: nowSec(),
          result: { preview_token: null, global_metadata: {}, messages: log, total_rows: 0, total_parents: 0 },
        });
        return;
      }
      Object.assign(task, {
        status: 'completed', progress: 100, messages: log, timestamp: nowSec(),
        result: { preview_token: previewToken, global_metadata: meta, messages: log, total_rows: rowStatus.length, total_parents: totalParents },
      });
    } catch (e) {
      logger.error(`❌ Error en tarea ${taskId}: ${e.stack}`);
      Object.assign(task, { status: 'error', error: e.message, progress: 100, timestamp: nowSec() });
      task.messages.push(e.stack);
    }
  })();

  return res.status(202).json({ task_id: taskId });
});

router.get('/api/task-status/:id', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const out = { status: t.status, progress: t.progress, messages: t.messages || [] };
  if (t.status === 'completed') out.result = cleanForJson(t.result);
  else if (t.status === 'error') out.error = t.error;
  return res.json(out);
});

router.post('/api/cancel-task/:id', (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ status: 'not_found', message: 'Task no existe o ya expiró' });
  t.cancelled = true;
  t.status = 'cancelled';
  logger.info(`🛑 Task ${req.params.id} marcada como cancelada`);
  return res.json({ status: 'cancelled', task_id: req.params.id });
});

// ---------------------------------------------------------------------------
// Previsualización
// ---------------------------------------------------------------------------
router.post('/api/confirm-folder', async (req, res) => {
  try {
    const { token, selected_hashes: selectedHashes = null, overwrite_hashes: overwriteHashes = [] } = req.body || {};
    const entry = tokenEntry(token);
    if (!entry) return res.status(404).json({ error: 'Token inválido o expirado' });
    const { processed_rows: rows } = entry;
    const zipName = entry.zip_filename || 'carga_carpeta';

    const toAction = (info, idx, action) => ({
      original_csv_index: info.original_csv_index ?? idx, action, data: info.data ?? info, _is_duplicate: info._is_duplicate ?? false,
      _supabase_matching_id: info._supabase_matching_id ?? null, _hash: info._hash, _is_parent: info._is_parent ?? false,
      _parent_id: info._parent_id ?? null, _parent_hash: info._parent_hash ?? null,
    });
    const actions = [];
    if (selectedHashes !== null) {
      const sel = new Set(selectedHashes.filter(Boolean).map(String));
      logger.info(`📥 confirm-folder: token=${String(token).slice(0, 8)}..., selected=${sel.size}, total_rows=${rows.length}`);
      rows.forEach((info, idx) => {
        if (info._hash == null || !sel.has(String(info._hash))) return;
        actions.push(toAction(info, idx, info._is_duplicate ? 'overwrite' : 'insert'));
      });
      if (!actions.length) return res.json({ status: 'ok', message: 'No se seleccionó ninguna fila para confirmar.', inserted: [], updated: [], debug: [] });
    } else {
      rows.forEach((info, idx) => {
        let action = 'insert';
        if (info._is_duplicate) action = info._hash && overwriteHashes.includes(info._hash) ? 'overwrite' : 'ignore';
        actions.push(toAction(info, idx, action));
      });
    }

    const debug = [];
    const { inserted, updated, insertedRows, updatedRows } = await applyBatchActions(actions, debug);
    await recordHistory(zipName, inserted, updated);
    previewCache.delete(token);
    let msg = 'No se realizaron cambios (no había filas seleccionadas para insertar/sobrescribir).';
    if (inserted || updated) {
      msg = `Se insertaron ${inserted} filas nuevas.`;
      if (updated > 0) msg += ` Se actualizaron ${updated} filas existentes.`;
    }
    return res.json({ status: 'ok', message: msg, debug, inserted: cleanForJson(insertedRows), updated: cleanForJson(updatedRows) });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/preview-page', (req, res) => {
  try {
    const { token } = req.body || {};
    const pageSize = parseInt(req.body?.page_size ?? 5, 10);
    let page = parseInt(req.body?.page ?? 1, 10);
    const entry = tokenEntry(token);
    if (!entry) return res.status(404).json({ error: 'Token inválido o expirado' });
    const parents = entry.processed_rows.filter((r) => r._is_parent);
    const totalPages = parents.length > 0 ? Math.ceil(parents.length / pageSize) : 1;
    page = Math.min(Math.max(page, 1), totalPages);
    const start = (page - 1) * pageSize;
    return res.json({
      preview_data: cleanForJson(parents.slice(start, Math.min(start + pageSize, parents.length))),
      page, total_pages: totalPages, total_rows: parents.length, page_size: pageSize,
    });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/preview-all', (req, res) => {
  try {
    const entry = tokenEntry(req.body?.token);
    if (!entry) return res.status(404).json({ error: 'Token inválido o expirado' });
    return res.json({ data: cleanForJson(entry.processed_rows), total: entry.processed_rows.length });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/preview-children', (req, res) => {
  try {
    const { token, parent_hash: parentHash } = req.body || {};
    const offset = parseInt(req.body?.offset ?? 0, 10);
    const limit = parseInt(req.body?.limit ?? 100, 10);
    const entry = tokenEntry(token);
    if (!entry) return res.status(404).json({ error: 'Token inválido o expirado' });
    const children = entry.processed_rows.filter((r) => r._is_child && r._parent_hash === parentHash);
    return res.json({
      children: cleanForJson(children.slice(offset, offset + limit)), total: children.length, offset, limit, has_more: offset + limit < children.length,
    });
  } catch (e) {
    return fail(res, e);
  }
});

router.get('/api/upload-history', async (_req, res) => {
  try {
    const { data } = await must(supabase.from('cargas').select('*').order('fecha', { ascending: false }).limit(50));
    return res.json(data || []);
  } catch (e) {
    logger.warn(`Error al obtener historial: ${e.message}`);
    return res.json([]);
  }
});
