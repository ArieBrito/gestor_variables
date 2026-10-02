// Utilidades que replican el comportamiento de Python/pandas usado por el notebook original
// (difflib.SequenceMatcher, float(), unicodedata, etc.) para mantener resultados idénticos.

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
const _accentCache = new Map();

/** Elimina acentos (NFKD + quitar marcas combinantes). Equivale a remover_acentos(). */
export function removerAcentos(s) {
  if (s === null || s === undefined || s === '') return '';
  const key = String(s);
  let r = _accentCache.get(key);
  if (r === undefined) {
    r = key.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (_accentCache.size > 4096) _accentCache.clear();
    _accentCache.set(key, r);
  }
  return r;
}

/** True si el valor es "NaN/None" de pandas (null, undefined o NaN numérico). */
export function isNA(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/** Convierte a cadena sin saltos de línea ni espacios extra (safe_clean). */
export function safeClean(v) {
  if (isNA(v)) return '';
  const s = String(v).replace(/\n/g, ' ').replace(/\r/g, ' ').trim();
  return s.replace(/\s+/g, ' ');
}

/** normalize_string: sin acentos, minúsculas, solo [a-z0-9] y espacios -> '_' */
export function normalizeString(s) {
  if (typeof s !== 'string') return '';
  let r = removerAcentos(s).toLowerCase();
  r = r.replace(/[^a-z0-9\s]/g, '');
  r = r.replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
  return r;
}

/** normalizar_texto / clean_text: ASCII puro, solo alfanuméricos y espacios, minúsculas. */
export function asciiClean(texto) {
  if (!texto) return '';
  let t = String(texto).normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  t = t.replace(/[^a-zA-Z0-9\s]/g, '');
  return t.toLowerCase().trim();
}

/** Comparador por code points (orden de str de Python). */
export function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Python: str.isdigit() (suficiente para ASCII/Unicode decimal). */
export function isDigitStr(s) {
  return /^\p{Nd}+$/u.test(s);
}

// ---------------------------------------------------------------------------
// Números (float() de Python, pd.to_numeric)
// ---------------------------------------------------------------------------
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * float(str) de Python. Devuelve number o null si Python lanzaría ValueError.
 * Acepta inf / infinity / nan (como Python).
 */
export function pyFloat(str) {
  const s = String(str).trim();
  if (FLOAT_RE.test(s)) return Number(s);
  const low = s.toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(low)) return low.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(low)) return NaN;
  return null;
}

/** pd.to_numeric(errors='coerce') de un valor suelto: number o NaN. */
export function toNumeric(v) {
  if (isNA(v)) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = pyFloat(v);
  return n === null ? NaN : n;
}

// ---------------------------------------------------------------------------
// difflib.SequenceMatcher(None, a, b).ratio()  (con autojunk=True, como Python)
// ---------------------------------------------------------------------------
export function sequenceRatio(aStr, bStr) {
  const a = Array.from(String(aStr));
  const b = Array.from(String(bStr));
  const la = a.length;
  const lb = b.length;
  if (la + lb === 0) return 1.0;

  // __chain_b
  const b2j = new Map();
  for (let i = 0; i < lb; i++) {
    const elt = b[i];
    let arr = b2j.get(elt);
    if (!arr) {
      arr = [];
      b2j.set(elt, arr);
    }
    arr.push(i);
  }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [elt, idxs] of [...b2j.entries()]) {
      if (idxs.length > ntest) b2j.delete(elt);
    }
  }

  const findLongest = (alo, ahi, blo, bhi) => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  };

  let matches = 0;
  const queue = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2.0 * matches) / (la + lb);
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------
/** Cede el control al event loop (para que el servidor siga respondiendo). */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

export const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Python: round-trip seguro a JSON (NaN/undefined -> null, recursivo). */
export function cleanForJson(data) {
  if (data === undefined) return null;
  if (data === null) return null;
  if (Array.isArray(data)) return data.map(cleanForJson);
  if (typeof data === 'number') return Number.isFinite(data) ? data : null;
  if (typeof data === 'bigint') return Number(data);
  if (data instanceof Set) return [...data].map(cleanForJson);
  if (typeof data === 'object') {
    if (data instanceof Date) return data.toISOString();
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k] = cleanForJson(v);
    return out;
  }
  return data;
}
