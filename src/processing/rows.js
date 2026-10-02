// Módulo 6 (desagregación): construye filas padre / hijo a partir de un Frame y los catálogos.
import { CODIGO_ESTADO_A_NOMBRE, EXPECTED_COLUMNS, KEYWORDS } from '../constants.js';
import { logger } from '../config.js';
import { computeRowHash } from '../hash.js';
import { toNumericClean } from '../normalize.js';
import { predictCategories } from '../ml.js';
import { findDisaggregationCatalog, getOutputNombreValue, isEstadoColumn } from './dictionary.js';

const KEEP = new Set([...EXPECTED_COLUMNS, 'parent_id']);
const pickKeep = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => KEEP.has(k)));
const firstKey = (tipo) => Object.keys(KEYWORDS[tipo])[0];

/** _crear_base_fila */
function crearBaseFila(meta) {
  const base = {
    proceso: meta.proceso || firstKey('proceso'),
    eje: meta.eje || firstKey('eje'),
    tema: meta.tema || firstKey('tema'),
    cobertura: meta.cobertura || '',
    periodicidad: meta.periodicidad || '',
    liga_web: meta.liga_web || '',
    fuente: meta.fuente || '',
    año: meta.año || '',
    parent_id: null,
  };
  if (base.año) {
    const n = parseFloat(base.año);
    if (Number.isFinite(n)) base.año = String(Math.trunc(n));
  }
  return base;
}

function newRow(data, existingHashes, extra) {
  const hash = computeRowHash(data);
  const existing = existingHashes.get(hash);
  return { hash, existing, row: { original_csv_index: -1, data, _hash: hash, ...extra } };
}

function buildParentRows(frame, aggCols, nombres, base, existingHashes, out) {
  aggCols.forEach((agg, i) => {
    const data = pickKeep({ ...base, nombre: nombres[i], valor: frame.sum(agg), estado: 'No aplica', parent_id: null });
    const { row, existing } = newRow(data, existingHashes, {});
    out.push({
      ...row,
      _is_duplicate: existing !== undefined,
      _supabase_matching_id: existing ? existing.id ?? null : null,
      _is_parent: true,
      _children_hashes: [],
      _parent_hash: null,
      _parent_id: null,
    });
  });
}

function resolveEstadoNombre(clave, catalogEstado) {
  if (!clave) return 'No aplica';
  let nombre = catalogEstado[clave];
  if (nombre === undefined) {
    for (const [k, v] of Object.entries(catalogEstado)) {
      if (k.trim().replace(/^0+/, '') === clave.replace(/^0+/, '')) {
        nombre = v;
        break;
      }
    }
  }
  if (nombre === undefined) nombre = CODIGO_ESTADO_A_NOMBRE[clave] ?? 'No aplica';
  return nombre;
}

function buildChildRows(frame, aggCols, nombres, groupCols, base, existingHashes, catalogEstado, catalogDesag, out) {
  const aggClean = aggCols.filter((c) => !groupCols.includes(c));
  if (!aggClean.length) return;
  const grouped = frame.groupSum(groupCols, aggClean);
  const nombresClean = nombres.slice(0, aggClean.length);

  // Hash del padre de cada columna (replica _build_parent_rows)
  const parentHash = {};
  aggClean.forEach((agg, i) => {
    parentHash[agg] = computeRowHash(
      pickKeep({ ...base, nombre: nombresClean[i], valor: frame.sum(agg), estado: 'No aplica', parent_id: null })
    );
  });

  let estadoCol = groupCols.find((c) => ['cve_ent', 'cvegeo'].includes(c)) ?? null;
  if (!estadoCol) estadoCol = groupCols.find((c) => c.toLowerCase().includes('ent') || c.toLowerCase().includes('estado')) ?? null;
  if (!estadoCol && groupCols.length) estadoCol = groupCols[0];
  const instCol = groupCols.find((c) => c !== estadoCol && !['cvegeo', 'cve_ent'].includes(c)) ?? null;
  let colSufijo = null;
  if (!instCol && Object.keys(catalogDesag).length && groupCols.length) {
    const cand = groupCols[0];
    if (!isEstadoColumn(cand) && !['cvegeo', 'cve_ent'].includes(cand)) colSufijo = cand;
  }
  logger.debug(`   🧭 child rows: estado_col='${estadoCol}', institucion_col='${instCol}', col_sufijo='${colSufijo}'`);

  const stateTotals = new Map();
  if (estadoCol && instCol && frame.has(estadoCol)) {
    for (const r of frame.groupSum([estadoCol], aggClean)) stateTotals.set(String(r[estadoCol]).trim(), r);
  }

  const emit = (nombre, valor, estado, pHash) => {
    const data = pickKeep({ ...base, nombre, valor, estado, parent_id: null });
    const { row, existing } = newRow(data, existingHashes, {});
    out.push({
      ...row,
      _is_duplicate: Boolean(existing),
      _supabase_matching_id: existing ? existing.id ?? null : null,
      _is_parent: false,
      _is_child: true,
      _parent_hash: pHash,
      _parent_id: null,
    });
  };

  let generated = 0;
  let last = null;
  for (const g of grouped) {
    const claveEstado = estadoCol && g[estadoCol] !== undefined ? String(g[estadoCol]).trim() : '';
    const estadoNombre = resolveEstadoNombre(claveEstado, catalogEstado);

    if (stateTotals.size && claveEstado && claveEstado !== last) {
      const st = stateTotals.get(claveEstado);
      if (st) {
        aggClean.forEach((agg, i) => {
          emit(`${nombresClean[i]} - ${estadoNombre} - Total`, st[agg], estadoNombre, parentHash[agg]);
          generated++;
        });
      }
      last = claveEstado;
    }

    let instNombre = null;
    if (instCol && g[instCol] !== undefined) {
      const clave = String(g[instCol]).trim();
      if (clave) {
        instNombre = catalogDesag[clave];
        if (instNombre === undefined) {
          logger.debug(`   ⚠️ Clave '${clave}' no encontrada en catálogo. Usando valor literal.`);
          instNombre = clave;
        }
      }
    }
    let sufijo = null;
    if (instNombre) sufijo = instNombre;
    else if (colSufijo && g[colSufijo] !== undefined) {
      const clave = String(g[colSufijo]).trim();
      if (clave) sufijo = catalogDesag[clave] || clave;
    }
    aggClean.forEach((agg, i) => {
      emit(sufijo ? `${nombresClean[i]} - ${sufijo}` : nombresClean[i], g[agg], estadoNombre, parentHash[agg]);
      generated++;
    });
  }
  logger.debug(`   ✅ child rows: ${generated} hijos para ${grouped.length} grupos × ${aggClean.length} columnas`);
}

/** process_disaggregated_data_vectorized */
export function processDisaggregatedData(frame, aggCols, nombres, groupCols, meta, existingHashes, catalogEstado, catalogDesag) {
  if (!aggCols.length) return [];
  const base = crearBaseFila(meta);
  const out = [];
  buildParentRows(frame, aggCols, nombres, base, existingHashes, out);
  if (groupCols.length) buildChildRows(frame, aggCols, nombres, groupCols, base, existingHashes, catalogEstado, catalogDesag, out);
  return out;
}

/** _process_disaggregation */
export function processDisaggregation(dataFile, aggList, dataDfs, catalogDir, existingHashes, meta, log) {
  const df = dataDfs.get(dataFile);
  if (!df) return [];
  let catalogEstado;
  let catalogDesag;
  let colDesag;
  let estadoCol;
  if (aggList.length) {
    ({ catalogEstado, catalogDesag, colDesag, estadoCol } = aggList[0]);
  } else {
    colDesag = estadoCol = df.columns[0];
    catalogEstado = findDisaggregationCatalog(estadoCol, catalogDir);
    catalogDesag = {};
    log.push(`   ⚠️ Fallback: col_desag='${colDesag}', estado_col='${estadoCol}'`);
  }
  const aggCols = aggList.map((a) => a.col);
  const nombres = aggList.map((a) => a.nombre);

  const groupCols = [];
  if (colDesag && df.has(colDesag)) {
    if (estadoCol && df.has(estadoCol) && estadoCol !== colDesag && isEstadoColumn(estadoCol)) groupCols.push(estadoCol);
    groupCols.push(colDesag);
    log.push(`   📊 Desagregación activa: group_cols=${JSON.stringify(groupCols)}`);
  } else log.push('   ℹ️ Sin desagregación (col_desag no válido o ausente). Solo se generarán padres.');

  log.push(`🔍 Desagregación para '${dataFile}' usando col_desag='${colDesag}', estado_col='${estadoCol}', agg_cols=${JSON.stringify(aggCols)}`);
  const rows = processDisaggregatedData(df, aggCols, nombres, groupCols, meta, existingHashes, catalogEstado, catalogDesag);
  log.push(`✅ Desagregación completada para '${dataFile}' (filas generadas: ${rows.length})`);
  return rows;
}

/** _build_output_row: fila de "Total general" (valor = suma de la columna). */
export function buildOutputRow(meta, frame, colName, colNombre, colDesc, colDef, dataFileKey, newFormat, indice, suffix = '') {
  const nums = toNumericClean(frame.col(colName)).filter((v) => !Number.isNaN(v));
  const total = nums.length ? nums.reduce((a, b) => a + b, 0) : null;

  const out = { ...meta };
  if (!out.año) {
    if (out.fuente) out.año = /\b(?:19|20)\d{2}\b/.exec(out.fuente)?.[0] ?? '';
    if (!out.año && dataFileKey) out.año = /(?:19|20)\d{2}/.exec(dataFileKey)?.[0] ?? '';
    if (!out.año) out.año = '';
  }
  if (out.año) {
    const n = parseFloat(out.año);
    if (Number.isFinite(n)) out.año = String(Math.trunc(n));
  }
  out.valor = total;

  let nombre = getOutputNombreValue(colNombre, colDesc, colDef, dataFileKey, newFormat, indice);
  if (!nombre || !nombre.trim()) {
    nombre = colNombre || colDesc;
    if (!nombre || !nombre.trim()) nombre = dataFileKey ? `Variable de ${dataFileKey}` : 'Variable sin nombre';
  }
  if (suffix) nombre = `${nombre} - ${suffix}`;
  out.nombre = nombre;
  out.estado = 'No aplica';

  const [proc, eje, temaPred] = predictCategories(nombre);
  let tema = temaPred;
  if (eje && tema) {
    const e = /Eje\s*(\d+)/.exec(eje);
    const t = /^(\d+)\./.exec(tema);
    if (e && t && e[1] !== t[1]) {
      const posibles = Object.keys(KEYWORDS.tema).filter((x) => x.startsWith(`${e[1]}.`));
      if (posibles.length) tema = posibles[0];
    }
  }
  out.proceso = proc || '';
  out.eje = eje || '';
  out.tema = tema || '';
  return out;
}
