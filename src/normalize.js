// Normalización de números (Módulo 4 del notebook): año / valor.
import { isNA, pyFloat } from './util/py.js';

export const VALORES_ESPECIALES = new Set(['NSS', 'NA', 'No aplica']);

function fmtValor(num, forDisplay) {
  if (Number.isNaN(num)) return 'nan';
  if (!Number.isFinite(num)) return num > 0 ? 'inf' : '-inf';
  if (Math.abs(num) > 1e15) return forDisplay ? String(num) : num.toExponential(6);
  return forDisplay ? String(num) : num.toFixed(1);
}

function fmtInt(num) {
  return BigInt(Math.trunc(num)).toString();
}

/**
 * normalizar_numero_texto: 'año'/'version' -> entero como texto; 'valor' -> 1 decimal
 * (o notación científica si |x| > 1e15). Conserva NSS/NA y cualquier texto no numérico.
 */
export function normalizarNumeroTexto(valor, columna = null, forDisplay = false) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') {
    const stripped = valor.trim();
    if (VALORES_ESPECIALES.has(stripped.toUpperCase())) return stripped;
    const cleaned = stripped.replace(/,/g, '').replace(/ /g, '');
    const num = pyFloat(cleaned);
    if (num === null) return stripped;
    if (columna === 'año' || columna === 'version') {
      return Number.isFinite(num) ? fmtInt(num) : stripped;
    }
    if (columna === 'valor') return fmtValor(num, forDisplay);
    return stripped;
  }
  if (typeof valor === 'number' && !Number.isNaN(valor)) {
    if (columna === 'año' || columna === 'version') return Number.isFinite(valor) ? fmtInt(valor) : String(valor);
    if (columna === 'valor') return fmtValor(valor, forDisplay);
    return String(valor);
  }
  if (typeof valor === 'number') return 'nan';
  try {
    return String(valor);
  } catch {
    return '';
  }
}

/** safe_normalize: tolera arrays/NaN. */
export function safeNormalize(val, colName) {
  if (Array.isArray(val)) val = val.length ? val[0] : '';
  if (isNA(val)) val = '';
  try {
    return normalizarNumeroTexto(val, colName);
  } catch {
    return val !== null && val !== undefined ? String(val) : '';
  }
}

/**
 * to_numeric_clean: convierte valores a número tratando NSS/NA/espacios como NaN.
 * @param {(string|number|null)[]} values
 * @param {string[]} logMessages
 */
export function toNumericClean(values, logMessages = []) {
  let nanCount = 0;
  const out = values.map((raw) => {
    const val = isNA(raw) ? 'nan' : String(raw).trim();
    let num;
    if (!val) num = NaN;
    else {
      const v = val.replace(/ /g, '');
      if (VALORES_ESPECIALES.has(v.toUpperCase())) num = NaN;
      else {
        const f = pyFloat(v);
        num = f === null ? NaN : f;
      }
    }
    if (Number.isNaN(num)) nanCount++;
    return num;
  });
  if (nanCount > 0) {
    logMessages.push(`⚠️ ${nanCount} valores no numéricos en la columna (ej: ${JSON.stringify(values.slice(0, 3))})`);
  }
  return out;
}
