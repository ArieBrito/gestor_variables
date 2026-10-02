// Rutas /api/variables*, /api/catalog/*, /api/search-suggestions y /api/download.
import { Router } from 'express';
import { chunkedDeleteByIds, fetchAllIds } from '../batch.js';
import { findBestValueMatch, loadAllCatalogs } from '../catalogs.js';
import { COLUMN_DISPLAY_NAMES, EXPECTED_COLUMNS } from '../constants.js';
import { logger } from '../config.js';
import {
  generarSiguienteId, getAllExistingIds, getAllVariablesData, getCatalogOptions, invalidateCatalogCache,
  must, refreshCaches, resetMaxIdCache, supabase,
} from '../db.js';
import { normalizarNumeroTexto } from '../normalize.js';
import { predictCategories } from '../ml.js';
import { adminRequired, apiAuth } from '../auth.js';
import { safeClean } from '../util/py.js';
import { fail } from './util.js';

export const router = Router();
router.use('/api', apiAuth);

const SELECT_COLS = 'id,proceso,eje,tema,nombre,cobertura,periodicidad,liga_web,fuente,año,estado,valor,parent_id';
const TEXT_COLS = ['proceso', 'eje', 'tema', 'nombre', 'institucion', 'cobertura', 'periodicidad', 'liga_web', 'fuente', 'estado'];
const FALLBACK_COLS = ['nombre', 'fuente', 'institucion', 'estado', 'proceso', 'eje', 'tema', 'cobertura', 'periodicidad', 'liga_web'];
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** _build_search_filter: OR de ilike sobre columnas de texto. */
function buildSearchFilter(term) {
  if (!term) return null;
  const cleaned = term.replace(/[,.:;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const safe = cleaned.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return TEXT_COLS.map((c) => `${c}.ilike.%${safe}%`).join(',');
}
const likePattern = (term) => `%${term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
const hasSpecial = (t) => /[,.:;]/.test(t);

/** Fallback por columna cuando el OR falla con comas/puntos en el término. */
async function searchIdsByColumnFallback(term) {
  const direct = new Set();
  const byParent = {};
  const pattern = likePattern(term);
  for (const col of FALLBACK_COLS) {
    try {
      const { data } = await must(supabase.from('variables').select('id').is('parent_id', null).ilike(col, pattern).limit(5000));
      for (const p of data || []) if (p.id) direct.add(p.id);
    } catch (e) {
      logger.warn(`   ⚠️ fallback padre '${col}' falló: ${e.message}`);
    }
    try {
      const { data } = await must(supabase.from('variables').select('id,parent_id').not('parent_id', 'is', null).ilike(col, pattern).limit(5000));
      for (const c of data || []) if (c.id && c.parent_id) (byParent[c.parent_id] ||= []).push(c.id);
    } catch (e) {
      logger.warn(`   ⚠️ fallback hijo '${col}' falló: ${e.message}`);
    }
  }
  return [direct, byParent];
}

async function searchChildIdsForParentFallback(parentId, term) {
  const matched = new Set();
  const pattern = likePattern(term);
  for (const col of FALLBACK_COLS) {
    try {
      const { data } = await must(supabase.from('variables').select('id').eq('parent_id', parentId).ilike(col, pattern).limit(2000));
      for (const r of data || []) if (r.id) matched.add(r.id);
    } catch (e) {
      logger.warn(`   ⚠️ fallback hijo col='${col}' para parent=${parentId} falló: ${e.message}`);
    }
  }
  return matched;
}

const normalizeRow = (item) => {
  const row = {};
  for (const [k, v] of Object.entries(item)) row[k] = safeClean(k === 'año' || k === 'valor' ? normalizarNumeroTexto(v, k) : v);
  return row;
};

// ---------------------------------------------------------------------------
router.post('/api/variables', async (req, res) => {
  try {
    const data = req.body || {};
    await refreshCaches(true);
    const used = new Set(await getAllExistingIds());
    const id = await generarSiguienteId(used);
    let anio = data['año'] || '';
    if (anio) {
      const n = parseFloat(anio);
      anio = Number.isFinite(n) ? String(Math.trunc(n)) : '';
    }
    const row = {
      id, proceso: data.proceso || '', eje: data.eje || '', tema: data.tema || '',
      nombre: data.nombre || 'Nueva variable', institucion: data.institucion || '', cobertura: data.cobertura || '',
      periodicidad: data.periodicidad || '', liga_web: data.liga_web || '', fuente: data.fuente || '',
      año: anio, estado: data.estado || '', valor: data.valor || '', parent_id: null,
    };
    const { data: ins } = await must(supabase.from('variables').insert(row).select());
    if (ins?.length) {
      await refreshCaches(true);
      logger.info(`✅ Variable creada: ${id} - ${row.nombre}`);
      return res.status(201).json({ status: 'ok', data: ins[0] });
    }
    return res.status(500).json({ error: 'No se pudo crear la variable en Supabase' });
  } catch (e) {
    return fail(res, e);
  }
});

router.get('/api/variables', async (req, res) => {
  try {
    const page = int(req.query.page, 1);
    const pageSize = int(req.query.page_size, 10);
    let sortField = req.query.sort_field || 'id';
    let sortDir = req.query.sort_dir || 'asc';
    const term = String(req.query.search || '').trim();
    if (![...EXPECTED_COLUMNS, 'valor'].includes(sortField)) sortField = 'id';
    if (!['asc', 'desc'].includes(sortDir)) sortDir = 'asc';
    const start = (page - 1) * pageSize;
    logger.debug(`🔍 api_vars: page=${page}, page_size=${pageSize}, sort=${sortField} ${sortDir}, search='${term.slice(0, 80)}'`);

    const matchingChildren = {};
    let query = supabase.from('variables').select(SELECT_COLS, { count: 'exact' }).is('parent_id', null);

    const filter = term ? buildSearchFilter(term) : null;
    if (filter) {
      let direct = new Set();
      try {
        const { data } = await must(supabase.from('variables').select('id').is('parent_id', null).or(filter).limit(5000));
        direct = new Set((data || []).map((p) => p.id));
      } catch (e) {
        logger.warn(`⚠️ Búsqueda directa de padres falló: ${e.message}`);
      }
      try {
        const { data } = await must(supabase.from('variables').select('id,parent_id').not('parent_id', 'is', null).or(filter).limit(5000));
        for (const c of data || []) if (c.parent_id && c.id) (matchingChildren[c.parent_id] ||= []).push(c.id);
      } catch (e) {
        logger.warn(`⚠️ Búsqueda de hijos falló: ${e.message}`);
      }
      let all = new Set([...direct, ...Object.keys(matchingChildren)]);
      if (!all.size && hasSpecial(term)) {
        logger.debug('🔁 api_vars: OR vacío con término complejo. Activando fallback por-columna');
        const [fbParents, fbChildren] = await searchIdsByColumnFallback(term);
        fbParents.forEach((p) => direct.add(p));
        for (const [pid, cids] of Object.entries(fbChildren)) (matchingChildren[pid] ||= []).push(...cids);
        all = new Set([...direct, ...Object.keys(matchingChildren)]);
      }
      if (!all.size) return res.json({ data: [], total: 0, page, page_size: pageSize, total_pages: 1 });
      query = query.in('id', [...all]);
    }

    query = query.order(sortField, { ascending: sortDir === 'asc' }).range(start, start + pageSize - 1);
    const { data: parents, count } = await must(query);
    const total = count ?? 0;
    const out = (parents || []).map((p) => ({
      ...normalizeRow(p), parent_id: null, _is_parent: true, _children_count: 0, _matching_children: matchingChildren[p.id] || [],
    }));
    return res.json({ data: out, total, page, page_size: pageSize, total_pages: total > 0 ? Math.ceil(total / pageSize) : 1 });
  } catch (e) {
    return fail(res, e);
  }
});

router.get('/api/search-suggestions', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ suggestions: [] });
    const safe = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const set = new Set();
    for (const col of ['nombre', 'fuente', 'institucion', 'estado', 'proceso', 'eje', 'tema']) {
      try {
        const { data } = await must(supabase.from('variables').select(col).ilike(col, `%${safe}%`).limit(6));
        for (const r of data || []) if (typeof r[col] === 'string' && r[col].trim()) set.add(r[col].trim());
      } catch (e) {
        logger.warn(`⚠️ Error buscando sugerencias en '${col}': ${e.message}`);
      }
      if (set.size >= 15) break;
    }
    const ordered = [...set].sort((a, b) => a.length - b.length || a.toLowerCase().localeCompare(b.toLowerCase())).slice(0, 15);
    return res.json({ suggestions: ordered });
  } catch (e) {
    return res.status(500).json({ suggestions: [], error: e.message });
  }
});

// --- Rutas con segmento fijo antes que ':id' ---
router.delete('/api/variables/bulk-delete', async (req, res) => {
  try {
    const ids = req.body?.ids || [];
    if (!ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const all = new Set(ids);
    try {
      const { data } = await must(supabase.from('variables').select('id').in('parent_id', ids));
      for (const c of data || []) if (c.id) all.add(c.id);
    } catch (e) {
      logger.warn(`⚠️ Error buscando hijos a borrar: ${e.message}`);
    }
    const deleted = await chunkedDeleteByIds([...all], 300);
    await refreshCaches(true);
    resetMaxIdCache();
    return res.json({ status: 'ok', deleted });
  } catch (e) {
    return fail(res, e);
  }
});

router.delete('/api/variables/delete-all', adminRequired, async (_req, res) => {
  try {
    const ids = await fetchAllIds(1000);
    const deleted = ids.length ? await chunkedDeleteByIds(ids, 300) : 0;
    await refreshCaches(true);
    resetMaxIdCache();
    return res.json({ status: 'ok', deleted });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/variables/bulk-duplicate', async (req, res) => {
  try {
    const ids = req.body?.ids || [];
    if (!ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const { data } = await must(supabase.from('variables').select('*').in('id', ids));
    if (!data?.length) return res.status(404).json({ error: 'No variables found' });
    const used = new Set(await getAllExistingIds());
    const dup = [];
    for (const row of data) {
      const id = await generarSiguienteId(used);
      used.add(id);
      dup.push({ ...row, id, año: normalizarNumeroTexto(row['año'], 'año'), valor: normalizarNumeroTexto(row.valor, 'valor') });
    }
    const { data: ins } = await must(supabase.from('variables').insert(dup).select());
    await refreshCaches();
    return res.status(201).json({ status: 'ok', inserted: ins || [] });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/variables/group', async (req, res) => {
  try {
    const raw = req.body?.parent_id ?? null;
    let childIds = req.body?.child_ids;
    if (!Array.isArray(childIds) || !childIds.length) return res.status(400).json({ error: 'child_ids debe ser una lista no vacía' });
    childIds = childIds.filter(Boolean).map(String);
    const unparent = raw === null || ['', '__UNPARENT__', 'null', 'None'].includes(String(raw).trim());
    let parentId = null;
    if (!unparent) {
      parentId = String(raw).trim();
      if (childIds.includes(parentId)) return res.status(400).json({ error: 'No puedes agrupar una fila dentro de sí misma' });
      const { data } = await must(supabase.from('variables').select('id,parent_id').eq('id', parentId));
      if (!data?.length) return res.status(404).json({ error: `Padre ${parentId} no encontrado` });
      if (data[0].parent_id !== null) {
        return res.status(400).json({ error: `La fila ${parentId} ya es hija de otra fila; solo filas padre pueden recibir hijos.` });
      }
    }
    let updated = 0;
    for (let i = 0; i < childIds.length; i += 200) {
      const { data } = await must(supabase.from('variables').update({ parent_id: parentId }).in('id', childIds.slice(i, i + 200)).select('id'));
      updated += data?.length || 0;
    }
    await refreshCaches(true);
    return res.json({ status: 'ok', parent_id: parentId, unparent, requested: childIds.length, updated });
  } catch (e) {
    return fail(res, e);
  }
});

router.put('/api/variables/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const { data: ex } = await must(supabase.from('variables').select('*').eq('id', id));
    if (!ex?.length) return res.status(404).json({ error: 'Variable no encontrada' });
    const current = ex[0];
    const cleaned = {};
    for (const [k, v] of Object.entries(body)) if (EXPECTED_COLUMNS.includes(k) && k !== 'id') cleaned[k] = v === null || v === undefined ? null : String(v);

    if (cleaned.nombre && (!current.proceso || !current.eje || !current.tema)) {
      const [proc, eje, tema] = predictCategories(cleaned.nombre);
      if (proc && !current.proceso) cleaned.proceso = proc;
      if (eje && !current.eje) cleaned.eje = eje;
      if (tema && !current.tema) cleaned.tema = tema;
    }
    if ('año' in cleaned) cleaned['año'] = normalizarNumeroTexto(cleaned['año'], 'año');
    if ('valor' in cleaned) cleaned.valor = normalizarNumeroTexto(cleaned.valor, 'valor');

    const { data: upd } = await must(supabase.from('variables').update(cleaned).eq('id', id).select());
    if (!upd?.length) return res.status(500).json({ error: 'Error al actualizar variable' });

    if (current.parent_id === null) {
      const propagate = {};
      for (const k of ['proceso', 'eje', 'tema', 'cobertura', 'periodicidad', 'liga_web', 'fuente', 'año']) if (k in cleaned) propagate[k] = cleaned[k];
      if (Object.keys(propagate).length) {
        try {
          const { data } = await must(supabase.from('variables').update(propagate).eq('parent_id', id).select('id'));
          logger.info(`✅ Propagados ${Object.keys(propagate).length} campos a ${data?.length || 0} hijos del padre ${id}`);
        } catch (e) {
          logger.warn(`⚠️ Error al propagar a hijos: ${e.message}`);
        }
      }
    }
    await refreshCaches();
    return res.json({ status: 'ok' });
  } catch (e) {
    return fail(res, e);
  }
});

router.delete('/api/variables/:id', async (req, res) => {
  try {
    const { data } = await must(supabase.from('variables').delete().eq('id', req.params.id).select('id'));
    if (data?.length) {
      await refreshCaches();
      return res.json({ status: 'ok' });
    }
    return res.status(404).json({ error: 'Registro no encontrado' });
  } catch (e) {
    return fail(res, e);
  }
});

router.get('/api/variables/:parentId/children', async (req, res) => {
  try {
    const parentId = req.params.parentId;
    let offset = int(req.query.offset, 0);
    let limit = int(req.query.limit, 100);
    const term = String(req.query.search || '').trim();
    if (offset < 0) offset = 0;
    if (limit <= 0 || limit > 500) limit = 100;
    const filter = term ? buildSearchFilter(term) : null;

    let cq = supabase.from('variables').select('id', { count: 'exact' }).eq('parent_id', parentId);
    if (filter) cq = cq.or(filter);
    let { count: total } = await must(cq);
    total = total ?? 0;

    let pq = supabase.from('variables').select('*').eq('parent_id', parentId).order('id');
    if (filter) pq = pq.or(filter);
    let { data: children } = await must(pq.range(offset, offset + limit - 1));
    children = children || [];

    if (term && total === 0 && hasSpecial(term)) {
      const ids = [...(await searchChildIdsForParentFallback(parentId, term))];
      if (ids.length) {
        total = ids.length;
        const { data: all } = await must(supabase.from('variables').select('*').in('id', ids));
        children = (all || []).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(offset, offset + limit);
      }
    }
    const normalized = children.map((c) => ({ ...normalizeRow(c), _is_child: true, parent_id: parentId }));
    return res.json({ children: normalized, total, offset, limit });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/variables/:id/duplicate', async (req, res) => {
  try {
    const { data } = await must(supabase.from('variables').select('*').eq('id', req.params.id));
    if (!data?.length) return res.status(404).json({ error: 'Variable no encontrada' });
    const dup = { ...data[0], id: await generarSiguienteId() };
    dup['año'] = normalizarNumeroTexto(dup['año'], 'año');
    dup.valor = normalizarNumeroTexto(dup.valor, 'valor');
    const { data: ins } = await must(supabase.from('variables').insert(dup).select());
    if (ins?.length) {
      await refreshCaches();
      return res.status(201).json(ins[0]);
    }
    return res.status(500).json({ error: 'Error al duplicar variable' });
  } catch (e) {
    return fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------
router.get('/api/catalog/:table', async (req, res) => {
  try {
    return res.json({ options: await getCatalogOptions(req.params.table) });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/catalog/:table', async (req, res) => {
  try {
    const table = req.params.table;
    const value = String(req.body?.value ?? '').trim();
    if (!value) return res.status(400).json({ error: 'Valor no puede estar vacío' });
    const options = await getCatalogOptions(table);
    const [match, score] = findBestValueMatch(value, options, 0.0);
    if (score === 1.0) return res.json({ status: 'already_exists', value: match });
    if (score > 0.7) return res.json({ status: 'suggestion', original_input: value, suggested_value: match });
    const { data } = await must(supabase.from(table).insert({ name: value }).select());
    if (data?.length) {
      invalidateCatalogCache(table);
      loadAllCatalogs().catch(() => {});
      return res.status(201).json({ status: 'inserted', value: data[0].name });
    }
    return res.status(500).json({ error: 'Error al agregar opción de catálogo' });
  } catch (e) {
    return fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Descarga CSV
// ---------------------------------------------------------------------------
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/api/download', async (_req, res) => {
  try {
    const data = await getAllVariablesData();
    const keyOf = (name) => ({ 'Liga Web': 'liga_web', Año: 'año' })[name] ?? name.toLowerCase();
    const display = COLUMN_DISPLAY_NAMES.filter((c) => c !== 'ID');
    const header = ['ID', 'Parent ID', ...display];
    const lines = [header.map(csvCell).join(',')];
    for (const row of data) {
      lines.push([row.id, row.parent_id, ...display.map((d) => row[keyOf(d)])].map(csvCell).join(','));
    }
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const filename = `variables_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(`\uFEFF${lines.join('\n')}\n`);
  } catch (e) {
    return fail(res, e);
  }
});

