// Mini "DataFrame" columnar para reemplazar el uso de pandas en el procesamiento de ZIP/CSV.
// Valores: string | null (null = NaN de pandas). Todas las columnas son texto (dtype=str).
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { cmpStr, toNumeric } from './py.js';

// Valores que pandas.read_csv interpreta como NaN por defecto (STR_NA_VALUES, pandas 2.2)
const NA_VALUES = new Set([
  '', '-1.#IND', '1.#QNAN', '1.#IND', '-1.#QNAN', '#N/A N/A', '#N/A', 'N/A', 'n/a', 'NA', '<NA>',
  '#NA', 'NULL', 'null', 'NaN', '-NaN', 'nan', '-nan', 'None',
]);

export class Frame {
  /**
   * @param {string[]} columns nombres de columna (únicos)
   * @param {Record<string,(string|null)[]>} data columnas
   * @param {number} length número de filas
   */
  constructor(columns, data, length) {
    this.columns = columns;
    this.data = data;
    this.length = length;
  }

  get empty() {
    return this.length === 0;
  }

  has(col) {
    return Object.prototype.hasOwnProperty.call(this.data, col);
  }

  col(name) {
    return this.data[name];
  }

  /** Serie numérica (NaN donde no se pueda convertir): pd.to_numeric(errors='coerce'). */
  numeric(name) {
    const c = this.data[name];
    const out = new Array(c.length);
    for (let i = 0; i < c.length; i++) out[i] = toNumeric(c[i]);
    return out;
  }

  /** Cuenta valores numéricos válidos de una columna. */
  numericCount(name) {
    const c = this.data[name];
    let n = 0;
    for (let i = 0; i < c.length; i++) if (!Number.isNaN(toNumeric(c[i]))) n++;
    return n;
  }

  /** Suma de la columna ignorando NaN (0 si todo es NaN), como Series.sum(). */
  sum(name) {
    let s = 0;
    for (const v of this.numeric(name)) if (!Number.isNaN(v)) s += v;
    return s;
  }

  /**
   * df.groupby(groupCols, as_index=False)[aggCols].sum()
   * - Claves ordenadas (sort=True) lexicográficamente por nivel.
   * - Filas con clave nula se descartan (dropna=True).
   * @returns {Array<Record<string, any>>} registros {groupCol..., aggCol...}
   */
  groupSum(groupCols, aggCols) {
    const numeric = {};
    for (const c of aggCols) numeric[c] = this.numeric(c);
    const keyCols = groupCols.map((c) => this.data[c]);
    const groups = new Map();
    for (let i = 0; i < this.length; i++) {
      let skip = false;
      const keys = new Array(groupCols.length);
      for (let k = 0; k < keyCols.length; k++) {
        const v = keyCols[k][i];
        if (v === null || v === undefined) {
          skip = true;
          break;
        }
        keys[k] = v;
      }
      if (skip) continue;
      const id = keys.join('\u0000');
      let g = groups.get(id);
      if (!g) {
        g = { keys, sums: aggCols.map(() => 0) };
        groups.set(id, g);
      }
      for (let a = 0; a < aggCols.length; a++) {
        const v = numeric[aggCols[a]][i];
        if (!Number.isNaN(v)) g.sums[a] += v;
      }
    }
    const list = [...groups.values()];
    list.sort((x, y) => {
      for (let k = 0; k < x.keys.length; k++) {
        const c = cmpStr(x.keys[k], y.keys[k]);
        if (c) return c;
      }
      return 0;
    });
    return list.map((g) => {
      const rec = {};
      groupCols.forEach((c, k) => (rec[c] = g.keys[k]));
      aggCols.forEach((c, a) => (rec[c] = g.sums[a]));
      return rec;
    });
  }
}

function decode(buf) {
  // utf-8 estricto; si hay bytes inválidos, latin-1 (los CSV de INEGI a veces vienen así)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('latin1').decode(buf);
  }
}

/** Convierte filas (arrays) a Frame con encabezado = primera fila. */
function rowsToFrame(rows, { lower = true } = {}) {
  if (!rows.length) throw new Error('No columns to parse from file');
  let header = rows[0].map((h) => String(h ?? ''));
  if (lower) header = header.map((h) => h.toLowerCase().trim());
  // pandas mangle_dupe_cols: a, a.1, a.2
  const seen = new Map();
  const columns = header.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}.${n}`;
  });
  const data = {};
  for (const c of columns) data[c] = [];
  const body = rows.slice(1);
  for (const r of body) {
    for (let i = 0; i < columns.length; i++) {
      const v = r[i];
      data[columns[i]].push(v === undefined || NA_VALUES.has(v) ? null : v);
    }
  }
  return new Frame(columns, data, body.length);
}

/**
 * pd.read_csv(path, dtype=str) con columnas en minúsculas/strip.
 * @param {string|Buffer} src ruta o buffer
 * @param {{nrows?: number}} opts
 */
export function readCsv(src, opts = {}) {
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  const text = decode(buf);
  const rows = parse(text, {
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    ...(opts.nrows ? { to_line: opts.nrows + 1 } : {}),
  });
  return rowsToFrame(rows, { lower: opts.lower !== false });
}

/** Lee un CSV como matriz de filas (sin encabezado), p. ej. para bloques del diccionario. */
export function parseRows(text) {
  return parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true, bom: true });
}

/** Valor NaN de pandas para texto de CSV */
export const isNaToken = (v) => NA_VALUES.has(v);
