// Módulos 6-7 (auxiliares): metadatos, diccionarios de datos, catálogos de desagregación y
// heurísticas de detección de columnas.
import fs from 'node:fs';
import path from 'node:path';
import { DISAGGREGATION_KEYWORDS, ESTADO_COLUMN_ALIASES } from '../constants.js';
import { logger } from '../config.js';
import { Frame, isNaToken, parseRows, readCsv } from '../util/frame.js';
import { normalizeString, removerAcentos, sequenceRatio } from '../util/py.js';

export const normalize_string = normalizeString;

const strip = (s, chars) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

export const isEstadoColumn = (colName) => Boolean(colName) && ESTADO_COLUMN_ALIASES.includes(String(colName).toLowerCase());

function readTextFile(file) {
  const buf = fs.readFileSync(file);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('latin1').decode(buf);
  }
}

// ---------------------------------------------------------------------------
// Metadatos globales
// ---------------------------------------------------------------------------
export function parseGlobalMetadatos(text, log = []) {
  const meta = { proceso: '', eje: '', tema: '', nombre: '', cobertura: '', periodicidad: '', liga_web: '', fuente: '', año: '' };
  if (!text) {
    log.push('⚠️ No hay texto de metadatos para parsear.');
    return meta;
  }
  const grab = (re) => {
    const m = re.exec(text);
    return m ? m[1].trim() : null;
  };

  const title = grab(/Title:[ \t]*(.+)/i);
  if (title) {
    meta.fuente = title;
    log.push(`📌 Fuente extraída de Title: ${title}`);
  }

  let cobertura = grab(/Spatial:[ \t]*(.+)/i);
  if (cobertura) {
    const l = cobertura.toLowerCase();
    if (l.includes('estatal')) cobertura = 'Estatal';
    else if (l.includes('federal')) cobertura = 'Federal';
    else if (l.includes('municipal')) cobertura = 'Municipal';
    else if (l.includes('mexico') || l.includes('mexicanos')) cobertura = 'Federal';
    meta.cobertura = cobertura;
    log.push(`🌐 Cobertura extraída de Spatial: ${cobertura}`);
  }

  const t = (meta.fuente || '').toLowerCase();
  const nivel = t.includes('federal') ? 'Federal' : t.includes('estatal') ? 'Estatal' : t.includes('municipal') ? 'Municipal' : null;
  if (nivel) {
    log.push(`🌐 Cobertura (por Title): ${nivel} (antes: '${meta.cobertura}')`);
    meta.cobertura = nivel;
  } else {
    log.push(`⚠️ No se pudo detectar nivel de gobierno en Title: '${(meta.fuente || '').slice(0, 80)}'`);
  }

  let per = grab(/AccrualPeriodicity:[ \t]*(.+)/i);
  if (per) {
    const l = per.toLowerCase();
    if (l.includes('anual')) per = 'Anual';
    else if (l.includes('mensual')) per = 'Mensual';
    else if (l.includes('trimestral')) per = 'Trimestral';
    else if (l.includes('semestral')) per = 'Semestral';
    meta.periodicidad = per;
    log.push(`📅 Periodicidad extraída: ${per}`);
  }

  const liga = grab(/Distribution:[ \t]*(.+)/i);
  if (liga) {
    meta.liga_web = liga;
    log.push(`🔗 Liga web extraída: ${liga}`);
  }

  let year = null;
  if (meta.fuente) {
    const m = /\b(?:19|20)\d{2}\b$/.exec(meta.fuente.trim());
    if (m) {
      year = m[0];
      log.push(`🔍 Año extraído del final de la fuente: ${year}`);
    }
  }
  if (!year) {
    const desc = grab(/Description:[ \t]*(.+)/i);
    const m = desc && /\b(?:19|20)\d{2}\b/.exec(desc);
    if (m) {
      year = m[0];
      log.push(`🔍 Año extraído de Description: ${year}`);
    }
  }
  if (!year) {
    const m = /\b(?:19|20)\d{2}\b/.exec(text);
    if (m) {
      year = m[0];
      log.push(`🔍 Año extraído de texto general: ${year}`);
    }
  }
  if (!year) {
    const m = /Temporal:[ \t]*(\d{4})-\d{2}-\d{2}/i.exec(text);
    if (m) {
      year = m[1];
      log.push(`🔍 Año extraído de Temporal: ${year}`);
    }
  }
  if (!year) {
    const m = /Identifier:[ \t]*(?:.*?)(\d{4})/i.exec(text);
    if (m) {
      year = m[1];
      log.push(`🔍 Año extraído de Identifier (fallback): ${year}`);
    }
  }
  meta.año = year || '';
  return meta;
}

// ---------------------------------------------------------------------------
// Diccionarios de datos
// ---------------------------------------------------------------------------
const _dictCache = new Map();

function processSection(dataLines, colIdx, descIdx, sectionDesc, target, log) {
  if (!dataLines.length) return;
  try {
    const rows = parseRows(dataLines.join('\n'));
    let n = 0;
    for (const row of rows) {
      const cell = (i) => {
        const v = row[i];
        return v === undefined || isNaToken(v) ? '' : String(v).trim();
      };
      const colName = cell(colIdx);
      if (!colName || /^\p{Nd}+$/u.test(colName) || colName.includes('NSS') || colName.includes('ND')) continue;
      let colDesc = cell(descIdx);
      if (!colDesc && sectionDesc) colDesc = sectionDesc;
      target.push({ 'Nombre de la columna': colName, Descripcion: colDesc, _seccion_desc: sectionDesc, UNNAMED_COL_8: cell(7) });
      n++;
    }
    if (n === 0) log.push('   ⚠️ No se encontraron filas de datos válidas en esta sección.');
  } catch (e) {
    log.push(`   ❌ Error al procesar datos de la sección: ${e.message}`);
  }
}

/**
 * parse_dictionary_csv.
 * 'new' -> [definiciones]; 'old' -> { archivo_dbf: [definiciones] }
 */
export function parseDictionaryCsv(filePath, formatType = 'old', log = []) {
  if (!['old', 'new'].includes(formatType)) throw new Error(`Tipo de formato desconocido: ${formatType}`);
  const key = `${path.resolve(filePath)}|${formatType}`;
  if (_dictCache.has(key)) {
    log.push(`📄 Cache hit: ${filePath}`);
    return _dictCache.get(key);
  }
  const empty = formatType === 'new' ? [] : {};
  const save = (v) => (_dictCache.set(key, v), v);

  let text;
  try {
    text = readTextFile(filePath);
  } catch (e) {
    log.push(`❌ Error al leer archivo '${filePath}': ${e.message}`);
    return save(empty);
  }
  const lines = text.split(/\r?\n/);
  if (!text.trim()) {
    log.push('⚠️ El archivo está vacío.');
    return save(empty);
  }

  if (formatType === 'new') {
    log.push('🔍 Procesando formato nuevo (encabezado único).');
    try {
      const df = readCsv(Buffer.from(text, 'utf8'), { lower: false });
      const norm = (c) => removerAcentos(c.trim().toLowerCase()).replace(/ /g, '_');
      const cols = {};
      for (const c of df.columns) {
        const n = norm(c);
        if (['columna', 'nombre_de_la_columna', 'campo', 'variable'].includes(n)) cols.name = c;
        else if (['descripcion', 'definicion', 'desc'].includes(n)) cols.desc = c;
        else if (['tipo_dato', 'tipodato', 'tipo'].includes(n)) cols.tipo = c;
        else if (n === 'origen') cols.origen = c;
      }
      if (!cols.name || !cols.desc) {
        log.push(`⚠️ Faltan columnas 'Columna'/'Descripción'. Encontradas: ${JSON.stringify(df.columns)}`);
        return save([]);
      }
      const defs = [];
      for (let i = 0; i < df.length; i++) {
        const name = (df.data[cols.name][i] ?? '').trim();
        if (!name) continue;
        defs.push({
          'Nombre de la columna': name,
          Descripcion: (df.data[cols.desc][i] ?? '').trim(),
          TIPO_DATO: cols.tipo ? (df.data[cols.tipo][i] ?? '').trim() : '',
          ORIGEN: cols.origen ? (df.data[cols.origen][i] ?? '').trim() : '',
        });
      }
      log.push(`✅ Formato nuevo: ${defs.length} definiciones (${defs.filter((d) => d.TIPO_DATO).length} con TIPO_DATO).`);
      return save(defs);
    } catch (e) {
      log.push(`❌ Error parsing formato nuevo: ${e.message}`);
      return save([]);
    }
  }

  // ---- Formato antiguo (múltiples secciones) ----
  log.push('🔍 Procesando formato antiguo (múltiples secciones).');
  const sections = {};
  let current = null;
  let currentDesc = '';
  let dataLines = [];
  let headerFound = false;
  let colIdx = 1;
  let descIdx = 2;

  const flush = () => {
    if (current !== null && dataLines.length) {
      sections[current] = [];
      processSection(dataLines, colIdx, descIdx, currentDesc, sections[current], log);
      log.push(`✅ Sección '${current}' procesada.`);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const clean = strip(line, '"');
    if (clean.includes('Archivo:') && clean.includes('.dbf')) {
      flush();
      dataLines = [];
      const m = /Archivo:\s*([^\s.]+)\.dbf/i.exec(clean);
      if (m) {
        current = m[1].toLowerCase();
        log.push(`🔎 Sección detectada: '${current}'`);
        const d = /\((.*?)\)/.exec(clean);
        currentDesc = d ? d[1].trim() : strip(clean.replace(/.*\.dbf/, '').trim(), ' ,');
        headerFound = false;
        continue;
      }
    }
    if (current === null) continue;
    if (!headerFound && (line.includes('Núm.de campo') || line.includes('Nombre de la columna'))) {
      headerFound = true;
      try {
        const parts = parseRows(line)[0] || [];
        parts.forEach((h, idx) => {
          const hn = removerAcentos(h.trim().toLowerCase()).replace(/ /g, '_');
          if (['nombre_de_la_columna', 'columna'].includes(hn)) colIdx = idx;
          else if (['descripcion', 'desc'].includes(hn)) descIdx = idx;
        });
        log.push(`   Encabezado: columna=${colIdx}, descripción=${descIdx}`);
      } catch {
        log.push('   ⚠️ Error parseando encabezado, usando índices por defecto (col=1, desc=2)');
      }
      continue;
    }
    if (line && !line.startsWith('"Censo') && !line.startsWith('Censo') && line !== ','.repeat(10) && line.replace(/,/g, '').trim()) {
      dataLines.push(line);
    }
  }
  flush();

  for (const k of Object.keys(sections)) if (!sections[k].length) delete sections[k];
  log.push(`✅ Total de secciones procesadas: ${Object.keys(sections).length}`);
  if (!Object.keys(sections).length) {
    log.push("⚠️ No se encontraron definiciones. Verifica que el archivo tenga secciones con 'Archivo: nombre.dbf'.");
  }
  return save(sections);
}

/** infer_consecutive_descriptions */
export function inferConsecutiveDescriptions(defs) {
  const processed = [];
  const grouped = new Map();
  for (const def of defs) {
    const name = def['Nombre de la columna'] || '';
    const m = /^([a-zA-Z_]+?)(\d+)$/.exec(name);
    if (m) {
      if (!grouped.has(m[1])) grouped.set(m[1], []);
      grouped.get(m[1]).push([parseInt(m[2], 10), def]);
    } else processed.push(def);
  }
  for (const [, list] of grouped) {
    list.sort((a, b) => a[0] - b[0]);
    let common = '';
    for (const [, orig] of list) {
      const def = { ...orig };
      const raw = (def.Descripcion || '').trim();
      let diff = '';
      if (def.Opciones && def.Opciones.trim()) diff = def.Opciones.trim();
      else if (def['Categoría'] && def['Categoría'].trim()) diff = def['Categoría'].trim();
      else if (def.UNNAMED_COL_8 && def.UNNAMED_COL_8.trim()) diff = def.UNNAMED_COL_8.trim();
      if (raw) {
        const cleaned = strip(raw, '.,;');
        def.Descripcion = diff ? `${cleaned} ${diff}` : cleaned;
        if (!common) common = cleaned;
      } else if (common) def.Descripcion = diff ? `${common} ${diff}` : common;
      else def.Descripcion = '';
      processed.push(def);
    }
  }
  return processed;
}

/** _clean_description */
export function cleanDescription(desc) {
  if (!desc) return '';
  let d = desc.replace(/,?\s*durante el año\s*\d{4}\s*\.?\s*/gi, '').replace(/,?\s*durante el\s*\d{4}\s*\.?\s*/gi, '');
  d = strip(d.trim(), '.,;:');
  return d ? d[0].toUpperCase() + d.slice(1) : d;
}

const PATRONES_DESC = [
  /^Contiene variables que caracterizan a la Administración Pública Federal de acuerdo con\s*/i,
  /^Contiene variables que caracterizan a la Administración Pública Federal de acuerdo a\s*/i,
  /^Contiene variables que caracterizan a la Administración Pública Federal según\s*/i,
  /^Contiene variables que caracterizan a la Administración Pública Federal\s*/i,
  /^Contiene variables que caracterizan\s*/i,
  /^Contiene variables que\s*/i,
  /^Variables que caracterizan\s*/i,
  /^Descripción:\s*/i,
  /^Definición:\s*/i,
];

function limpiarDescripcion(desc) {
  if (!desc) return desc;
  let d = desc;
  for (const p of PATRONES_DESC) d = d.replace(p, '');
  d = d.trim();
  if (!d) return desc;
  d = d.replace(/^de acuerdo con\s*/i, '').replace(/^de acuerdo a\s*/i, '').replace(/^según\s*/i, '');
  if (d) d = d[0].toUpperCase() + d.slice(1);
  return d.trim();
}

/** Nombre legible de un archivo de datos según el índice (0_indice). */
export function lookupIndiceName(dataFileKey, indice) {
  if (!indice || !Object.keys(indice).length) return '';
  const base = String(dataFileKey).split('.')[0].toLowerCase();
  const candidates = [base, base.split('_')[0], base.replace('_cnge2025', ''), base.replace('_cng2025', ''), base.replace('_cnge', ''), base.replace('_cng', '')];
  for (const k of candidates) if (k && Object.prototype.hasOwnProperty.call(indice, k)) return String(indice[k]).trim();
  return '';
}

/** _get_output_nombre_value */
export function getOutputNombreValue(colNombre, colDescripcion, _colDef, dataFileName, newFormat, indice) {
  let nombre = '';
  if (newFormat) {
    const content = lookupIndiceName(dataFileName, indice);
    const desc = limpiarDescripcion(colDescripcion) || '';
    if (content) nombre = desc ? `${content} - ${desc}` : content;
    else nombre = desc || colNombre;
  }
  if (typeof nombre === 'string') {
    nombre = cleanDescription(nombre).replace(/,?\s*durante el año\s*\d{4}\s*\.?\s*/gi, '');
    nombre = strip(strip(nombre.trim(), ','), '.');
  }
  if (!nombre || !nombre.trim()) nombre = colNombre && colNombre.trim() ? colNombre : 'Sin nombre';
  return String(nombre).trim();
}

// ---------------------------------------------------------------------------
// Coincidencia de columnas / archivos
// ---------------------------------------------------------------------------
/** _find_matching_column (exacta, normalizada, difusa > 0.7) */
export function findMatchingColumn(colName, frame) {
  const name = String(colName).trim();
  if (!name) return null;
  if (frame.has(name)) return name;
  const norm = normalizeString(name);
  for (const c of frame.columns) if (normalizeString(c) === norm) return c;
  let best = null;
  let bestScore = 0.7;
  for (const c of frame.columns) {
    const s = sequenceRatio(norm, normalizeString(c));
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/** _find_matching_data_file: acepta Map/objeto/arreglo de nombres de archivo. */
export function findMatchingDataFile(baseName, files) {
  const keys = files instanceof Map ? [...files.keys()] : Array.isArray(files) ? files : Object.keys(files);
  const b = baseName.toLowerCase();
  for (const k of keys) {
    const kb = k.replace(/\.[^.]*$/, '').toLowerCase();
    if (b.includes(kb) || kb.includes(b)) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidatas a agregación
// ---------------------------------------------------------------------------
export function isAggregationCandidate(colNombre, colDescripcion, matchedCol, newFormat, _kw, tipoDato = null, isGrouping = false) {
  if (!matchedCol) return [false, 'no se encontró una columna coincidente en el DataFrame'];
  if (isGrouping) return [false, 'columna de agrupación (estado/institución/catálogo)'];
  const desc = removerAcentos((colDescripcion || '').toLowerCase().trim());
  if (desc.includes('identificador')) {
    logger.debug(`   🚫 '${colNombre}' excluida (descripción contiene 'identificador')`);
    return [false, "descripción contiene 'identificador'"];
  }
  if (desc.includes('numeral')) {
    logger.debug(`   🚫 '${colNombre}' excluida (descripción contiene 'numeral')`);
    return [false, "descripción contiene 'numeral'"];
  }
  if (newFormat && tipoDato !== null && tipoDato !== undefined && String(tipoDato).trim()) {
    const t = removerAcentos(String(tipoDato).toLowerCase().trim());
    if (['caracter', 'caracteres', 'carácteres', 'texto', 'string'].includes(t)) return [true, `TIPO_DATO='${tipoDato}'`];
    return [false, `TIPO_DATO='${tipoDato}' (no es Carácter)`];
  }
  if (desc.includes('clasificacion')) return [false, "descripción contiene 'clasificación'"];
  for (const kw of ['total', 'hombres', 'mujeres', 'subtotal', 'no especificado']) {
    if (kw.includes(' ') ? desc.includes(kw) : new RegExp(`\\b${kw}\\b`).test(desc)) return [true, `descripción contiene '${kw}' (fallback)`];
  }
  return [false, 'sin TIPO_DATO=Carácter y sin palabra clave de agregación'];
}

// ---------------------------------------------------------------------------
// Catálogos de desagregación
// ---------------------------------------------------------------------------
export const defaultEstadosCatalog = () => ({
  '01': 'Aguascalientes', '02': 'Baja California', '03': 'Baja California Sur', '04': 'Campeche',
  '05': 'Coahuila de Zaragoza', '06': 'Colima', '07': 'Chiapas', '08': 'Chihuahua', '09': 'Ciudad de México',
  '10': 'Durango', '11': 'Guanajuato', '12': 'Guerrero', '13': 'Hidalgo', '14': 'Jalisco', '15': 'México',
  '16': 'Michoacán de Ocampo', '17': 'Morelos', '18': 'Nayarit', '19': 'Nuevo León', '20': 'Oaxaca',
  '21': 'Puebla', '22': 'Querétaro', '23': 'Quintana Roo', '24': 'San Luis Potosí', '25': 'Sinaloa',
  '26': 'Sonora', '27': 'Tabasco', '28': 'Tamaulipas', '29': 'Tlaxcala', '30': 'Veracruz de Ignacio de la Llave',
  '31': 'Yucatán', '32': 'Zacatecas',
});

/** _load_catalog_from_file -> { clave: nombre } */
export function loadCatalogFromFile(filePath, { keyCol = null, descCol = null, preferredKeyCol = null } = {}) {
  let df;
  try {
    df = readCsv(filePath, { lower: false });
  } catch (e) {
    logger.warn(`⚠️ No se pudo leer ${filePath}: ${e.message}`);
    return {};
  }
  if (df.empty) return {};
  if (keyCol === null || descCol === null) {
    if (preferredKeyCol) keyCol = df.columns.find((c) => c.toLowerCase() === preferredKeyCol.toLowerCase()) ?? keyCol;
    if (keyCol === null) {
      keyCol = df.columns.find((c) => ['cve', 'clave', 'id', 'autoinst', 'inst', 'tipo'].some((p) => c.toLowerCase().includes(p))) ?? null;
    }
    if (descCol === null) {
      descCol = df.columns.find((c) => ['nom', 'nombre', 'entidad', 'desc', 'descrip'].some((p) => c.toLowerCase().includes(p))) ?? null;
    }
    if (keyCol === null && descCol === null && df.columns.length === 2) [keyCol, descCol] = df.columns;
  }
  if (keyCol === null || descCol === null) {
    logger.warn(`⚠️ No se pudieron identificar columnas clave/desc en ${filePath}`);
    return {};
  }
  const catalog = {};
  for (let i = 0; i < df.length; i++) {
    const k = df.data[keyCol][i];
    const v = df.data[descCol][i];
    if (k !== null && v !== null && k.trim() && v.trim()) catalog[k.trim()] = v.trim();
  }
  return catalog;
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const csvFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
};

/** _find_disaggregation_catalog */
export function findDisaggregationCatalog(colName, dictDir, colDesc = null, preferredKeyCol = null) {
  if (!colName || !isDir(dictDir)) return isEstadoColumn(colName) ? defaultEstadosCatalog() : {};
  const lower = String(colName).toLowerCase().trim();
  const parent = path.dirname(dictDir);
  const dirs = [dictDir];
  if (isDir(parent) && !dirs.includes(parent)) dirs.push(parent);
  for (const sub of ['conjunto_de_datos', 'catalogos', 'diccionario_de_datos']) {
    const c = path.join(parent, sub);
    if (isDir(c) && !dirs.includes(c)) dirs.push(c);
  }
  logger.debug(`🔍 Buscando catálogo para '${colName}' en ${JSON.stringify(dirs)}`);

  for (const dir of dirs) {
    for (const f of csvFiles(dir)) {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      let clean = base;
      for (const suf of ['_cnge2025', '_cng2025', '_cnge', '_cngf2025', '_cngf', '_cngf_2025', '_cng']) {
        if (clean.endsWith(suf)) {
          clean = clean.slice(0, -suf.length);
          break;
        }
      }
      if (clean === lower || base.startsWith(`${lower}_`)) {
        const cat = loadCatalogFromFile(f, { preferredKeyCol: colName });
        if (Object.keys(cat).length) {
          logger.debug(`✅ Catálogo cargado: ${path.basename(f)} -> ${Object.keys(cat).length} entradas`);
          return cat;
        }
      }
    }
  }
  for (const f of csvFiles(dictDir)) {
    try {
      const peek = readCsv(f, { lower: false, nrows: 5 });
      if (peek.columns.length === 2) {
        const cat = loadCatalogFromFile(f, { keyCol: peek.columns[0], descCol: peek.columns[1] });
        if (Object.keys(cat).length) return cat;
      }
    } catch {
      /* siguiente */
    }
  }
  if (isEstadoColumn(colName)) {
    logger.warn(`❌ No se encontró catálogo para '${colName}'. Usando catálogo por defecto de estados.`);
    return defaultEstadosCatalog();
  }
  logger.warn(`❌ No se encontró catálogo para '${colName}'. Se usará el valor literal.`);
  return {};
}

// ---------------------------------------------------------------------------
// Detección de columnas de estado / desagregación
// ---------------------------------------------------------------------------
/** _detect_disaggregation_columns_from_dict -> [colDesag, estadoCol] */
export function detectDisaggregationColumns(df, defs, catalogDir, log = []) {
  let colDesag = null;
  let estadoCol = null;

  const estadoCands = [];
  for (const d of defs) {
    const name = String(d['Nombre de la columna'] || '').trim();
    const desc = String(d.Descripcion || '').trim().toLowerCase();
    if (!name || !df.has(name)) continue;
    let peso = 0;
    if (desc.includes('clave del agee')) peso = 3;
    else if (desc.includes('clave geoestadística') || desc.includes('cve_ent')) peso = 2;
    else if (['entidad federativa', 'cvegeo', 'estado'].some((p) => desc.includes(p))) peso = 1;
    if (peso > 0) estadoCands.push([name, peso]);
  }
  if (estadoCands.length) {
    estadoCands.sort((a, b) => b[1] - a[1]);
    estadoCol = estadoCands[0][0];
    log.push(`   🗺️ Estado detectado por descripción: '${estadoCol}' (peso ${estadoCands[0][1]})`);
  } else {
    const c = df.columns.find((x) => isEstadoColumn(x));
    if (c) {
      estadoCol = c;
      log.push(`   ⚠️ Estado detectado por alias (fallback): '${estadoCol}'`);
    }
  }

  const cands = [];
  for (const d of defs) {
    const name = String(d['Nombre de la columna'] || '').trim();
    const desc = String(d.Descripcion || '').trim().toLowerCase();
    if (!name || !df.has(name) || name === estadoCol) continue;
    let score = 0;
    if (DISAGGREGATION_KEYWORDS.some((k) => desc.includes(k))) score = 3;
    else if (desc.includes('institución') || desc.includes('instituciones') || desc.includes('nombre')) score = 2;
    else if (desc.includes('autoridad') || desc.includes('tipo')) score = 1;
    if (score > 0) cands.push([name, score]);
  }
  if (cands.length) {
    cands.sort((a, b) => b[1] - a[1]);
    colDesag = cands[0][0];
    log.push(`   ✅ Desagregación detectada por descripción: '${colDesag}' (score ${cands[0][1]})`);
  } else {
    log.push('   ⚠️ Sin desagregación por descripción. Probando por nombre de columna...');
    for (const c of df.columns) {
      if (c === estadoCol || c === 'cvegeo' || c === 'cve_ent') continue;
      if (['autoinst', 'inst', 'nombre1', 'nombre', 'institucion', 'tipo'].some((x) => c.toLowerCase().includes(x))) {
        colDesag = c;
        log.push(`   ✅ Desagregación detectada por nombre de columna: '${colDesag}'`);
        break;
      }
    }
  }

  if (estadoCol && !isEstadoColumn(estadoCol)) {
    if (colDesag && isEstadoColumn(colDesag)) {
      [estadoCol, colDesag] = [colDesag, estadoCol];
      log.push('   🔄 Intercambiados estado/desagregación (col_desag era estado)');
    } else {
      const c = df.columns.find((x) => isEstadoColumn(x));
      if (c) {
        estadoCol = c;
        log.push(`   🔄 Forzado estado a '${estadoCol}'`);
      }
    }
  }

  if (!colDesag) {
    if (estadoCol && isEstadoColumn(estadoCol)) {
      colDesag = estadoCol;
      log.push(`   📍 Sin institución detectada → desagregando por ESTADO: '${colDesag}'`);
    } else {
      const first = defs.map((d) => String(d['Nombre de la columna'] || '').trim()).find((n) => n && df.has(n));
      if (!first) log.push('   ℹ️ No hay columnas válidas en el diccionario → no se desagregará (solo padre).');
      else {
        let test = {};
        if (catalogDir) {
          try {
            test = findDisaggregationCatalog(first, catalogDir);
          } catch (e) {
            log.push(`   ⚠️ Error buscando catálogo para '${first}': ${e.message}`);
          }
        }
        if (Object.keys(test).length) {
          colDesag = first;
          log.push(`   📍 Sin institución/estado → usando PRIMERA columna como desagregación: '${colDesag}' (${Object.keys(test).length} entradas)`);
          if (estadoCol === colDesag) estadoCol = null;
        } else log.push(`   ℹ️ Sin institución/estado y SIN catálogo para '${first}' → no se desagregará (solo padre).`);
      }
    }
  }
  log.push(`   🔍 RESULTADO FINAL: col_desag='${colDesag}', estado_col='${estadoCol}'`);
  return [colDesag, estadoCol];
}

export { Frame };
