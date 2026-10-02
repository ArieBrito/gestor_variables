// Módulos 7 y 10 (ZIP): extracción, localización de carpetas, descubrimiento de variables y
// pipeline completo de generación de filas padre/hijo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { EXPECTED_COLUMNS } from '../constants.js';
import { logger } from '../config.js';
import { buildExistingHashes, computeRowHash } from '../hash.js';
import { refreshCaches } from '../db.js';
import { normalizeCatalogColumns } from '../catalogs.js';
import { readCsv } from '../util/frame.js';
import { tick } from '../util/py.js';
import {
  detectDisaggregationColumns, findDisaggregationCatalog, findMatchingColumn, findMatchingDataFile,
  getOutputNombreValue, inferConsecutiveDescriptions, isAggregationCandidate, lookupIndiceName,
  parseDictionaryCsv, parseGlobalMetadatos,
} from './dictionary.js';
import { buildOutputRow, processDisaggregation } from './rows.js';
import { cleanOldPreviewCache, previewCache, uuid } from '../state.js';

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const listCsv = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv') && isFile(path.join(dir, f))).sort();
  } catch {
    return [];
  }
};
const listFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => isFile(path.join(dir, f)));
  } catch {
    return [];
  }
};

/** Recorre recursivamente los directorios bajo root (rglob('*') solo directorios). */
function* walkDirs(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const p = path.join(root, e.name);
      yield p;
      yield* walkDirs(p);
    }
  }
}

// ---------------------------------------------------------------------------
// Extracción y localización de carpetas
// ---------------------------------------------------------------------------
function findFolderByAliases(root, aliases, typeName, log, requiredPattern = null) {
  const patterns = requiredPattern === null ? null : Array.isArray(requiredPattern) ? requiredPattern : [requiredPattern];
  const candidates = [];
  for (const dir of walkDirs(root)) {
    const name = path.basename(dir).toLowerCase();
    const words = name.replace(/_/g, ' ').replace(/-/g, ' ').split(/\s+/);
    if (!aliases.some((a) => a === name || words.includes(a))) continue;
    if (patterns && !listFiles(dir).some((f) => patterns.some((p) => f.startsWith(p)))) continue;
    candidates.push(dir);
  }
  if (!candidates.length) {
    log.push(`⚠️ No se encontró carpeta para '${typeName}' con aliases ${JSON.stringify(aliases)}`);
    return null;
  }
  const depth = (p) => path.relative(root, p).split(path.sep).length;
  candidates.sort((a, b) => depth(a) - depth(b) || listCsv(b).length - listCsv(a).length);
  log.push(`📁 Carpeta '${typeName}' encontrada: ${candidates[0]}`);
  return candidates[0];
}

function findBestDataFolder(tmpdir, log) {
  for (const dir of walkDirs(tmpdir)) {
    const n = path.basename(dir).toLowerCase();
    if (n === 'conjunto_de_datos' || n === 'conjunto_datos') {
      log.push(`📁 Encontrado por nombre exacto: ${dir}`);
      return dir;
    }
  }
  for (const dir of walkDirs(tmpdir)) {
    if (['diccionario', 'catalogo', 'metadatos'].some((x) => path.basename(dir).toLowerCase().includes(x))) continue;
    const hit = listFiles(dir).find((f) => f.endsWith('.csv') && (f.startsWith('m1s5p') || f.startsWith('0_indice')));
    if (hit) {
      log.push(`📁 Encontrado por contenido: ${dir} (archivo: ${hit})`);
      return dir;
    }
  }
  let best = null;
  let max = 0;
  for (const dir of [tmpdir, ...walkDirs(tmpdir)]) {
    if (['diccionario', 'catalogo', 'metadatos'].some((x) => path.basename(dir).toLowerCase().includes(x))) continue;
    const n = listFiles(dir).filter((f) => f.endsWith('.csv')).length;
    if (n > max) {
      max = n;
      best = dir;
    }
  }
  if (best) {
    log.push(`📁 Fallback por cantidad de CSVs: ${best} (${max} archivos)`);
    return best;
  }
  log.push('📁 Fallback extremo: usando la raíz del ZIP como conjunto de datos');
  return tmpdir;
}

function findFirstDirWith(tmpdir, pred) {
  for (const dir of [tmpdir, ...walkDirs(tmpdir)]) if (listFiles(dir).some(pred)) return dir;
  return null;
}

function findMetadatosFile(tmpdir, log) {
  const folder = findFolderByAliases(tmpdir, ['metadatos', 'metadato', 'metadata'], 'metadatos', log);
  if (folder) {
    const txt = listFiles(folder).filter((f) => f.endsWith('.txt'));
    if (txt.length) return path.join(folder, txt[0]);
  }
  for (const dir of [tmpdir, ...walkDirs(tmpdir)]) {
    const f = listFiles(dir).find((x) => x.endsWith('.txt') && x.toLowerCase().includes('metadatos'));
    if (f) return path.join(dir, f);
  }
  return null;
}

/** _extract_and_find_folders -> {tmpdir, conjunto, diccionario, catalogos, metadatos} */
export function extractAndFindFolders(zipBytes, log) {
  const t0 = Date.now();
  log.push('🔄 Descomprimiendo ZIP...');
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip_extract_'));
  let extracted = 0;
  let normalized = 0;
  const zip = new AdmZip(zipBytes);
  for (const entry of zip.getEntries()) {
    let name = entry.entryName;
    if (name.includes('\\')) {
      name = name.replace(/\\/g, '/');
      normalized++;
    }
    if (!name || name.startsWith('/')) continue;
    const parts = name.split('/').filter((p) => !['', '.', '..'].includes(p));
    if (!parts.length) continue;
    if (entry.isDirectory) {
      fs.mkdirSync(path.join(tmpdir, ...parts), { recursive: true });
      continue;
    }
    try {
      fs.mkdirSync(path.join(tmpdir, ...parts.slice(0, -1)), { recursive: true });
      fs.writeFileSync(path.join(tmpdir, ...parts), entry.getData());
      extracted++;
    } catch (e) {
      log.push(`⚠️ No se pudo extraer '${entry.entryName}': ${e.message}`);
    }
  }
  if (normalized) log.push(`🔧 Normalizados ${normalized} nombres con backslash (ZIP de Windows).`);
  log.push(`✅ ZIP descomprimido en ${((Date.now() - t0) / 1000).toFixed(2)}s (${extracted} archivos)`);

  const conjunto =
    findFolderByAliases(tmpdir, ['conjunto_de_datos', 'conjunto_datos'], 'conjunto de datos', log, ['m1s5p', 'm1s3p', 'm1s', '0_indice']) ||
    findBestDataFolder(tmpdir, log);
  let diccionario = findFolderByAliases(tmpdir, ['diccionario_de_datos', 'diccionario_datos'], 'diccionario de datos', log);
  if (!diccionario) {
    diccionario = findFirstDirWith(tmpdir, (f) => f.startsWith('diccionario_de_datos') && f.endsWith('.csv')) || tmpdir;
    log.push(`📁 Fallback: usando '${diccionario}' como diccionario`);
  }
  let catalogos = findFolderByAliases(tmpdir, ['catalogos', 'catalogo'], 'catálogos', log);
  if (!catalogos) {
    catalogos = findFirstDirWith(tmpdir, (f) => f.endsWith('.csv') && (f.includes('cve_ent') || f.includes('nom_ent'))) || diccionario || tmpdir;
    log.push(`📁 Fallback: usando '${catalogos}' como carpeta de catálogos`);
  }
  const metadatos = findMetadatosFile(tmpdir, log);
  return { tmpdir, conjunto, diccionario, catalogos, metadatos };
}

/** _detect_format_and_build_paths */
export function detectFormatAndPaths(folders, log) {
  const { tmpdir } = folders;
  let newFormat = false;
  let indiceFilename = null;
  for (const dir of [tmpdir, folders.conjunto].filter(Boolean)) {
    const f = listFiles(dir).find((x) => x.endsWith('.csv') && x.startsWith('0_indice'));
    if (f) {
      log.push(`📌 Formato nuevo detectado: archivo índice '${f}' en ${dir}`);
      newFormat = true;
      indiceFilename = f;
      break;
    }
  }
  log.push(`📁 Carpetas encontradas (formato ${newFormat ? 'nuevo' : 'antiguo'})`);
  let dataDir = folders.conjunto;
  if (!dataDir || !isDir(dataDir)) {
    dataDir = findBestDataFolder(tmpdir, log);
    log.push(`⚠️ Usando fallback para conjunto: ${dataDir}`);
  }
  const dictDir = folders.diccionario && isDir(folders.diccionario) ? folders.diccionario : tmpdir;
  const catDir = folders.catalogos && isDir(folders.catalogos) ? folders.catalogos : dataDir;
  const metaPath = folders.metadatos && isFile(folders.metadatos) ? folders.metadatos : null;
  return { dataDir, dictDir, catDir, metaPath, newFormat, indiceFilename };
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------
export function loadDataFrames(dataDir, log) {
  const dfs = new Map();
  for (const f of listCsv(dataDir)) {
    try {
      const df = readCsv(path.join(dataDir, f));
      dfs.set(f, df);
      log.push(`✅ Cargado ${f} con ${df.columns.length} columnas, ${df.length} filas.`);
    } catch (e) {
      log.push(`⚠️ Error al cargar ${f}: ${e.message}`);
    }
  }
  return dfs;
}

export function loadGlobalMetadatos(metaPath, log) {
  let text = '';
  if (metaPath && isFile(metaPath)) {
    try {
      text = fs.readFileSync(metaPath, 'utf8');
      log.push(`📄 Metadatos cargados desde: ${metaPath}`);
    } catch (e) {
      log.push(`⚠️ Error al leer metadatos: ${e.message}`);
    }
  }
  return parseGlobalMetadatos(text, log);
}

/** _load_index_descriptions -> { archivo_base: descripción } */
export function loadIndexDescriptions(dataDir, newFormat, indiceFilename, log) {
  if (!newFormat || !indiceFilename) return {};
  for (const base of [dataDir, path.dirname(dataDir), '.']) {
    const p = path.join(base, indiceFilename);
    if (!isFile(p)) continue;
    try {
      const df = readCsv(p, { lower: false });
      const cols = df.columns.map((c) => c.trim().toUpperCase());
      const ia = cols.indexOf('ARCHIVO');
      const ic = cols.indexOf('CONTENIDO');
      if (ia >= 0 && ic >= 0) {
        const out = {};
        for (let i = 0; i < df.length; i++) {
          const a = df.data[df.columns[ia]][i];
          const c = df.data[df.columns[ic]][i];
          out[a ? a.replace(/\.[^.]*$/, '').toLowerCase() : ''] = c ?? '';
        }
        log.push(`📑 Archivo de índice cargado: ${Object.keys(out).length} descripciones.`);
        return out;
      }
    } catch (e) {
      log.push(`⚠️ Error al cargar índice: ${e.message}`);
    }
  }
  return {};
}

const findCatalogDir = (dataDir, dictDir) => {
  for (const c of [path.join(path.dirname(dataDir), 'catalogos'), path.join(dataDir, 'catalogos')]) if (isDir(c)) return c;
  return dictDir;
};

// ---------------------------------------------------------------------------
// Candidatas a agregación
// ---------------------------------------------------------------------------
/** @returns {Array<{col,nombre,catalogEstado,catalogDesag,colDesag,estadoCol}>} */
function extractCandidates(defs, df, matchedKey, colDesag, estadoCol, catalogEstado, catalogDesag, newFormat, kw, indice, log, sel) {
  const out = [];
  const grouping = new Set([estadoCol, colDesag, 'cvegeo', 'cve_ent'].filter(Boolean));
  log.push(`      🔎 candidatas: '${matchedKey}', selección=${sel ? `activa (${sel.size} pares)` : 'sin filtro'}`);
  for (const def of defs) {
    const colNombre = String(def['Nombre de la columna'] || '').trim();
    const colDesc = String(def.Descripcion || '').trim();
    if (!colNombre) continue;
    const matched = findMatchingColumn(colNombre, df);
    if (!matched || grouping.has(matched)) continue;

    let isTotal;
    let reason;
    if (sel) {
      if (!sel.has(`${matchedKey}\u0000${matched}`)) continue;
      isTotal = true;
      reason = 'selección explícita del usuario';
    } else [isTotal, reason] = isAggregationCandidate(colNombre, colDesc, matched, newFormat, kw, def.TIPO_DATO ?? null, false);
    if (!isTotal) continue;

    if (df.numericCount(matched) === 0) {
      log.push(`      ⚠️ '${matched}' no tiene valores numéricos; se ignora.`);
      continue;
    }
    let nombre = getOutputNombreValue(colNombre, colDesc, def, matchedKey, newFormat, indice);
    if (!nombre || !nombre.trim()) nombre = colNombre || 'Sin nombre';
    out.push({ col: matched, nombre, catalogEstado, catalogDesag, colDesag, estadoCol });
    log.push(`      ✅ '${matched}' agregada (motivo: ${reason})`);
  }
  return out;
}

function descOf(defs, colName) {
  if (!colName) return '';
  const d = defs.find((x) => String(x['Nombre de la columna'] || '').trim().toLowerCase() === colName.toLowerCase());
  return d ? String(d.Descripcion || '').trim() : '';
}

/** Detecta desagregación y catálogos para un (diccionario, archivo de datos). */
function detectForFile(defs, df, catDir) {
  const [colDesag, estadoCol] = detectDisaggregationColumns(df, defs, catDir, []);
  const catalogEstado = estadoCol ? findDisaggregationCatalog(estadoCol, catDir, null) : {};
  const catalogDesag =
    colDesag && colDesag !== estadoCol ? findDisaggregationCatalog(colDesag, catDir, descOf(defs, colDesag), colDesag) : {};
  return { colDesag, estadoCol, catalogEstado, catalogDesag };
}

function processSingleDictionary(dictFile, dictDir, newFormat, dataDfs, catDir, kw, indice, log, sel) {
  const local = new Map();
  try {
    const parsed = parseDictionaryCsv(path.join(dictDir, dictFile), newFormat ? 'new' : 'old', []);
    if (!parsed || (Array.isArray(parsed) ? !parsed.length : !Object.keys(parsed).length)) return local;
    const pairs = [];
    if (newFormat) {
      const base = dictFile.replace('diccionario_de_datos_', '').replace('.csv', '');
      const key = findMatchingDataFile(base, dataDfs);
      if (!key) return local;
      pairs.push([key, inferConsecutiveDescriptions(parsed)]);
    } else {
      for (const [dataKey, defs] of Object.entries(parsed)) {
        const key = findMatchingDataFile(dataKey, dataDfs);
        if (key) pairs.push([key, inferConsecutiveDescriptions(defs)]);
      }
    }
    for (const [key, defs] of pairs) {
      const df = dataDfs.get(key);
      const det = detectForFile(defs, df, catDir);
      const cands = extractCandidates(defs, df, key, det.colDesag, det.estadoCol, det.catalogEstado, det.catalogDesag, newFormat, kw, indice, log, sel);
      if (cands.length) local.set(key, [...(local.get(key) || []), ...cands]);
    }
  } catch (e) {
    log.push(`⚠️ Error al procesar diccionario '${dictFile}': ${e.message}`);
  }
  return local;
}

async function identifyAggregationColumns(dictFiles, dataDfs, catDir, dictDir, newFormat, kw, indice, log, progress, sel) {
  logger.debug('🔍 Iniciando identificación de columnas de agregación');
  log.push(`🔒 selección activa: ${sel ? `${sel.size} pares` : 'ninguna (procesar todo)'}`);
  const info = new Map();
  for (let i = 0; i < dictFiles.length; i++) {
    const local = processSingleDictionary(dictFiles[i], dictDir, newFormat, dataDfs, catDir, kw, indice, log, sel);
    for (const [k, v] of local) info.set(k, [...(info.get(k) || []), ...v]);
    if (progress) progress(65 + Math.floor(5 * (i / dictFiles.length)), `🔍 Procesando diccionario ${i + 1}/${dictFiles.length}`);
    await tick();
  }
  const total = [...info.values()].reduce((a, v) => a + v.length, 0);
  log.push(`✅ Identificación completada: ${total} agregaciones en ${info.size} archivos.`);
  return info;
}

// ---------------------------------------------------------------------------
// Totales generales de diccionarios restantes
// ---------------------------------------------------------------------------
function processRemainingDictionaries(dictFiles, dataDfs, processed, meta, newFormat, kw, indice, existingHashes, dictDir, log, sel) {
  const results = [];
  const selFiles = sel ? new Set([...sel].map((s) => s.split('\u0000')[0])) : null;
  if (sel) log.push(`🔒 filtro de selección activo (${selFiles.size} data files, ${sel.size} columnas).`);

  const handle = (key, defs, df) => {
    for (const def of defs) {
      const colNombre = def['Nombre de la columna'] || '';
      const colDesc = def.Descripcion || '';
      const matched = findMatchingColumn(colNombre, df);
      if (!matched) continue;
      if (sel && !sel.has(`${key}\u0000${matched}`)) continue;
      const [isTotal] = isAggregationCandidate(colNombre, colDesc, matched, newFormat, kw, def.TIPO_DATO ?? null);
      if (!isTotal) continue;
      const row = buildOutputRow(meta, df, matched, colNombre, colDesc, def, key, newFormat, indice, 'Total general');
      const hash = computeRowHash(row);
      const existing = existingHashes.get(hash);
      Object.assign(row, {
        _is_duplicate: existing !== undefined,
        _supabase_matching_id: existing ? existing.id ?? null : null,
        _hash: hash,
        _is_parent: true,
        _parent_hash: null,
        _parent_id: null,
      });
      results.push(row);
      log.push(`   ✅ Total general '${colNombre}' en '${key}' (dup=${existing !== undefined})`);
    }
  };

  for (const dictFile of dictFiles) {
    try {
      const parsed = parseDictionaryCsv(path.join(dictDir, dictFile), newFormat ? 'new' : 'old', log);
      if (!parsed || (Array.isArray(parsed) ? !parsed.length : !Object.keys(parsed).length)) continue;
      const targets = [];
      if (newFormat) {
        const base = dictFile.replace('diccionario_de_datos_', '').replace('.csv', '');
        const key = findMatchingDataFile(base, dataDfs);
        if (!key) {
          log.push(`   ⏭️ Dict '${dictFile}': no se encontró data file para '${base}'. Saltando.`);
          continue;
        }
        targets.push([key, inferConsecutiveDescriptions(parsed)]);
      } else {
        for (const [dk, defs] of Object.entries(parsed)) {
          const key = findMatchingDataFile(dk, dataDfs);
          if (key) targets.push([key, inferConsecutiveDescriptions(defs)]);
        }
      }
      for (const [key, defs] of targets) {
        if (selFiles && !selFiles.has(key)) {
          log.push(`   ⏭️ Dict '${dictFile}': '${key}' no está en la selección del usuario. Saltando.`);
          continue;
        }
        if (processed.has(key)) {
          log.push(`   ⏭️ Dict '${dictFile}': '${key}' ya procesado por el pipeline principal. Saltando.`);
          continue;
        }
        log.push(`   📄 Procesando restante: dict='${dictFile}' → data='${key}'`);
        handle(key, defs, dataDfs.get(key));
      }
    } catch (e) {
      log.push(`❌ Error al procesar diccionario '${dictFile}': ${e.message}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Filtrado y construcción del resultado
// ---------------------------------------------------------------------------
const cleanData = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));

/** _build_row_status */
function buildRowStatus(row) {
  if ('data' in row) return { ...row };
  return {
    original_csv_index: -1,
    _is_duplicate: row._is_duplicate ?? false,
    _supabase_matching_id: row._supabase_matching_id ?? null,
    _hash: row._hash ?? null,
    _is_parent: row._is_parent ?? false,
    _is_child: row._is_child ?? false,
    _parent_hash: row._parent_hash ?? null,
    _parent_id: row._parent_id ?? null,
    _nuevo_en_catalogo: {},
    data: cleanData(row),
  };
}

/** _filter_and_build_dataframe -> { finalRows, messages, rowStatus } */
function filterAndBuild(allResults, log) {
  const messages = [];
  if (!allResults.length) {
    messages.push('⚠️ No se encontraron filas que cumplan los criterios de agregación.');
    log.push(...messages);
    return { finalRows: [], rowStatus: [] };
  }
  messages.push(`🔍 Total de filas antes del filtro: ${allResults.length}`);
  const rowStatus = [];
  for (const r of allResults) {
    const st = buildRowStatus(r);
    const d = st.data;
    if (!String(d.nombre ?? '').trim()) {
      d.nombre = `Variable sin nombre (id: ${d.id ?? 'desconocido'})`;
      messages.push(`   ⚠️ Nombre vacío, se asignó: '${d.nombre}'`);
    }
    if (d.valor === null || d.valor === undefined) continue;
    rowStatus.push(st);
  }
  messages.push(`🧹 Filtradas filas con valor None. Quedan ${rowStatus.length} filas.`);
  if (!rowStatus.length) messages.push('⚠️ No se encontraron filas válidas después del filtrado.');

  // _normalize_final_dataframe (sobre copias; los datos de rowStatus no se modifican)
  const finalRows = rowStatus.map((s) => {
    const d = { ...s.data };
    for (const c of EXPECTED_COLUMNS) if (!(c in d)) d[c] = '';
    if (d.año !== undefined && d.año !== null && String(d.año).trim() !== '') {
      const n = parseFloat(d.año);
      d.año = Number.isFinite(n) ? String(Math.trunc(n)) : '';
    } else d.año = '';
    if (d.estado === undefined || d.estado === null || String(d.estado).trim() === '') d.estado = 'No aplica';
    return d;
  });
  normalizeCatalogColumns(finalRows);
  log.push(...messages);
  return { finalRows, rowStatus };
}

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------
/**
 * process_data_folders_with_return.
 * @returns {{finalRows: object[], meta: object, rowStatus: object[]}}
 */
export async function processDataFolders({ dataDir, dictDir, catalogDir, metaPath, newFormat, indiceFilename, aggKeywords, log, progress, sel }) {
  log.push('🚀 ENTRANDO A process_data_folders_with_return');
  if (!isDir(dictDir) || !isDir(dataDir)) {
    log.push("❌ Error: No se encontraron las carpetas 'diccionario_de_datos' o 'conjunto_de_datos'.");
    return { finalRows: [], meta: {}, rowStatus: [] };
  }
  const dataDfs = loadDataFrames(dataDir, log);
  if (!dataDfs.size) {
    log.push("❌ No se encontraron archivos CSV válidos en 'conjunto_de_datos'.");
    return { finalRows: [], meta: {}, rowStatus: [] };
  }
  let catDir = catalogDir && isDir(catalogDir) ? catalogDir : findCatalogDir(dataDir, dictDir);
  log.push(`📁 Ruta de catálogos: ${catDir}`);

  const meta = loadGlobalMetadatos(metaPath, log);
  log.push('📊 Metadatos globales analizados.');
  log.push(`   Año extraído de metadatos: ${meta.año || ''}`);
  const indice = loadIndexDescriptions(dataDir, newFormat, indiceFilename, log);

  await refreshCaches(true);
  const existingHashes = await buildExistingHashes(null, log);

  const dictFiles = listCsv(dictDir);
  const kw = aggKeywords || ['total', 'totales'];
  const agg = await identifyAggregationColumns(dictFiles, dataDfs, catDir, dictDir, newFormat, kw, indice, log, progress, sel);
  if (!agg.size) {
    log.push('⚠️ No se detectaron columnas de agregación en los diccionarios. No se generarán filas.');
    return { finalRows: [], meta, rowStatus: [] };
  }

  const all = [];
  const processed = new Set();
  const total = agg.size;
  let idx = 0;
  for (const [dataFile, list] of agg) {
    const msg = `📄 Procesando archivo ${idx + 1}/${total}: ${dataFile} (columna: ${list[0]?.col} -> '${(list[0]?.nombre || '').slice(0, 40)}...')`;
    log.push(msg);
    logger.debug(msg);
    if (progress) progress(70 + Math.floor(20 * (idx / total)), msg);
    const rows = processDisaggregation(dataFile, list, dataDfs, catDir, existingHashes, meta, log);
    all.push(...rows);
    processed.add(dataFile);
    log.push(`   ✅ ${dataFile}: ${rows.length} filas generadas (${idx + 1}/${total})`);
    if (!rows.length) log.push(`   ⚠️ ADVERTENCIA: No se generaron filas para ${dataFile}.`);
    idx++;
    await tick();
  }
  log.push(`🔄 Desagregación total completada: ${all.length} filas generadas de ${total} archivos.`);

  all.push(...processRemainingDictionaries(dictFiles, dataDfs, processed, meta, newFormat, kw, indice, existingHashes, dictDir, log, sel));
  if (!all.length) log.push("⚠️ No se generaron filas. Verifica que los diccionarios contengan columnas con 'total' en la descripción.");

  const { finalRows, rowStatus } = filterAndBuild(all, log);
  return { finalRows, meta, rowStatus };
}

/**
 * _process_zip_file: procesa el ZIP completo y guarda el resultado en la caché de previsualización.
 * @param {{sel?: Set<string>|null, onProgress?: (p:number,msg:string)=>void}} opts
 */
export async function processZipFile(zipBytes, filename, log, { sel = null, onProgress = null } = {}) {
  const t0 = Date.now();
  log.push(`📦 Procesando ZIP (completo): ${filename}`);
  const report = (p, msg) => {
    if (p % 5 === 0 || p === 100) {
      logger.info(msg);
      log.push(msg);
    }
    if (onProgress) onProgress(p, msg);
  };
  let tmpdir = null;
  try {
    report(10, '📂 Descomprimiendo ZIP...');
    const folders = extractAndFindFolders(zipBytes, log);
    tmpdir = folders.tmpdir;
    await tick();
    report(15, '🔍 Detectando formato...');
    const paths = detectFormatAndPaths(folders, log);
    const aggKeywords = paths.newFormat ? ['total', 'totales', 'cantidad', 'sum'] : ['cantidad de', 'total'];

    report(20, '⏳ Procesando TODOS los archivos (esto puede tomar unos segundos)...');
    const { finalRows, meta, rowStatus } = await processDataFolders({
      dataDir: paths.dataDir, dictDir: paths.dictDir, catalogDir: paths.catDir, metaPath: paths.metaPath,
      newFormat: paths.newFormat, indiceFilename: paths.indiceFilename, aggKeywords, log, progress: report, sel,
    });

    const totalHijos = rowStatus.filter((r) => r._is_child).length;
    const totalPadres = rowStatus.filter((r) => r._is_parent).length;
    log.push(`⏱️ Tiempo de procesamiento: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    log.push(`👨‍👧 Total padres: ${totalPadres}, Total hijos: ${totalHijos}`);

    const previewToken = uuid();
    previewCache.set(previewToken, {
      timestamp: Date.now() / 1000, processed_rows: rowStatus, total_rows: rowStatus.length,
      total_parents: totalPadres, global_metadata: meta, zip_filename: filename, log_messages: log,
    });
    cleanOldPreviewCache();
    report(100, `✅ Procesamiento completado en ${((Date.now() - t0) / 1000).toFixed(2)}s: ${totalPadres} padres, ${totalHijos} hijos`);
    return { finalRows, meta, rowStatus, totalParents: totalPadres, previewToken };
  } finally {
    if (tmpdir) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
      log.push(`🧹 Directorio temporal eliminado: ${tmpdir}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Descubrimiento de variables (sin procesar datos)
// ---------------------------------------------------------------------------
function listDictionaryVariables(defs, df, colDesag, estadoCol, newFormat, dataFileKey, indice) {
  const grouping = new Set([estadoCol, colDesag, 'cvegeo', 'cve_ent'].filter(Boolean));
  const out = [];
  for (const def of defs) {
    const colNombre = String(def['Nombre de la columna'] || '').trim();
    const colDesc = String(def.Descripcion || '').trim();
    const tipo = def.TIPO_DATO ?? null;
    if (!colNombre) continue;
    const matched = findMatchingColumn(colNombre, df);
    if (!matched) continue;
    const isGrouping = grouping.has(matched);
    let isAgg = false;
    let reason = 'columna de agrupación';
    if (!isGrouping) [isAgg, reason] = isAggregationCandidate(colNombre, colDesc, matched, newFormat, ['total', 'totales'], tipo, false);
    let display;
    try {
      display = getOutputNombreValue(colNombre, colDesc, def, dataFileKey, newFormat, indice);
    } catch {
      display = colNombre;
    }
    out.push({
      column: matched,
      dictionary_name: colNombre,
      description: colDesc.slice(0, 300),
      display_name: (display || colNombre).slice(0, 300),
      tipo_dato: (tipo || '').slice(0, 40),
      is_aggregation_candidate: Boolean(isAgg),
      aggregation_reason: reason,
      is_numeric: df.numericCount(matched) > 0,
      is_grouping: isGrouping,
    });
  }
  return out;
}

/** _discover_variables_in_dictionaries */
export function discoverVariables(dictDir, dataDir, catDir, newFormat, indice, log) {
  const results = [];
  const dataKeys = listCsv(dataDir);
  for (const dictFile of listCsv(dictDir)) {
    let parsed;
    try {
      parsed = parseDictionaryCsv(path.join(dictDir, dictFile), newFormat ? 'new' : 'old', []);
    } catch (e) {
      log.push(`⚠️ No se pudo parsear ${dictFile}: ${e.message}`);
      continue;
    }
    if (!parsed || (Array.isArray(parsed) ? !parsed.length : !Object.keys(parsed).length)) continue;

    const targets = [];
    if (newFormat) {
      const base = dictFile.replace('diccionario_de_datos_', '').replace('.csv', '');
      const key = findMatchingDataFile(base, dataKeys);
      if (!key) {
        log.push(`⏭️ Sin data file para ${dictFile}`);
        continue;
      }
      targets.push([key, inferConsecutiveDescriptions(parsed)]);
    } else {
      for (const [dk, defs] of Object.entries(parsed)) {
        const key = findMatchingDataFile(dk, dataKeys);
        if (key) targets.push([key, inferConsecutiveDescriptions(defs)]);
      }
    }
    for (const [key, defs] of targets) {
      let peek;
      try {
        peek = readCsv(path.join(dataDir, key), { nrows: 200 });
      } catch (e) {
        log.push(`⚠️ No se pudo leer ${key}: ${e.message}`);
        continue;
      }
      const [colDesag, estadoCol] = detectDisaggregationColumns(peek, defs, catDir, []);
      results.push({
        dict_file: dictFile,
        data_file: key,
        display_file_name: lookupIndiceName(key, indice),
        desag_column: colDesag,
        estado_column: estadoCol,
        variables: listDictionaryVariables(defs, peek, colDesag, estadoCol, newFormat, key, indice),
      });
    }
  }
  return results;
}
