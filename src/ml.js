// Módulo 9: modelos ML (TF-IDF + Multinomial Naive Bayes, equivalente al Pipeline de scikit-learn)
// y predicción por palabras clave. Los modelos se guardan como JSON en modelos/.
import fs from 'node:fs';
import { KEYWORDS } from './constants.js';
import { MODELS_DIR, MODEL_PATHS, UMBRAL_CONFIANZA, logger } from './config.js';
import { fetchAll, supabase } from './db.js';
import { asciiClean } from './util/py.js';

export const clean_text = asciiClean;
export const normalizarTexto = asciiClean;

// ---------------------------------------------------------------------------
// Palabras clave (fallback)
// ---------------------------------------------------------------------------
let _kwNorm = null;
function kwNorm() {
  if (!_kwNorm) {
    _kwNorm = {};
    for (const tipo of ['proceso', 'eje', 'tema']) {
      _kwNorm[tipo] = Object.entries(KEYWORDS[tipo]).map(([cat, words]) => [cat, words.map(asciiClean)]);
    }
  }
  return _kwNorm;
}

export function predecirPorPalabrasClave(texto) {
  if (!texto) return [null, null, null];
  const t = asciiClean(texto);
  const best = (tipo) => {
    let bestCat = null;
    let bestScore = 0;
    for (const [cat, words] of kwNorm()[tipo]) {
      let score = 0;
      for (const w of words) if (t.includes(w)) score++;
      if (score > bestScore) {
        bestScore = score;
        bestCat = cat;
      }
    }
    return bestScore === 0 ? null : bestCat;
  };
  if (!t) return [null, null, null];
  return [best('proceso'), best('eje'), best('tema')];
}

// ---------------------------------------------------------------------------
// TF-IDF + Naive Bayes
// ---------------------------------------------------------------------------
const STOP_EN = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by can did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves').split(' ')
);

function tokenize(text) {
  const words = (text.match(/\b\w\w+\b/g) || []).filter((w) => !STOP_EN.has(w));
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  return grams;
}

function tfidfVector(tokens, vocab, idf) {
  const counts = new Map();
  for (const t of tokens) {
    const idx = vocab[t];
    if (idx !== undefined) counts.set(idx, (counts.get(idx) || 0) + 1);
  }
  let norm = 0;
  const vec = [];
  for (const [idx, c] of counts) {
    const v = c * idf[idx];
    vec.push([idx, v]);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  return vec.map(([i, v]) => [i, v / norm]);
}

function fitPipeline(texts, labels, alpha = 1.0, maxFeatures = 5000) {
  const docs = texts.map(tokenize);
  const df = new Map();
  const tf = new Map();
  for (const d of docs) {
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }
  const terms = [...tf.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxFeatures).map(([t]) => t).sort();
  const vocab = {};
  terms.forEach((t, i) => (vocab[t] = i));
  const n = docs.length;
  const idf = terms.map((t) => Math.log((1 + n) / (1 + df.get(t))) + 1);
  const classes = [...new Set(labels)].sort();
  const nf = terms.length;
  const featCount = classes.map(() => new Array(nf).fill(0));
  const classCount = new Array(classes.length).fill(0);
  docs.forEach((d, i) => {
    const ci = classes.indexOf(labels[i]);
    classCount[ci]++;
    for (const [fi, v] of tfidfVector(d, vocab, idf)) featCount[ci][fi] += v;
  });
  const featLogProb = featCount.map((row) => {
    const total = row.reduce((a, b) => a + b, 0) + alpha * nf;
    return row.map((v) => Math.log((v + alpha) / total));
  });
  const classLogPrior = classCount.map((c) => Math.log(c / n));
  return { vocab, idf, classes, featLogProb, classLogPrior };
}

function predictProba(model, text) {
  const vec = tfidfVector(tokenize(text), model.vocab, model.idf);
  const jll = model.classes.map((_, ci) => {
    let s = model.classLogPrior[ci];
    for (const [fi, v] of vec) s += v * model.featLogProb[ci][fi];
    return s;
  });
  const max = Math.max(...jll);
  const exps = jll.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

// ---------------------------------------------------------------------------
// Carga / entrenamiento
// ---------------------------------------------------------------------------
let models = null;
const _cache = new Map();

export const modelsLoaded = () => models !== null;

export function loadModels() {
  _cache.clear();
  try {
    if (Object.values(MODEL_PATHS).every((p) => fs.existsSync(p))) {
      models = {};
      for (const [k, p] of Object.entries(MODEL_PATHS)) models[k] = JSON.parse(fs.readFileSync(p, 'utf8'));
      logger.info('✅ Modelos ML cargados correctamente.');
    } else {
      models = null;
      logger.warn('⚠️ Modelos ML no encontrados. Usando fallback por palabras clave.');
    }
  } catch (e) {
    models = null;
    logger.error(`❌ Error al cargar modelos: ${e.message}. Usando fallback por palabras clave.`);
  }
}

export function unloadModels() {
  models = null;
  _cache.clear();
}

/** predict_categories -> [proceso, eje, tema] (con caché por texto). */
export function predictCategories(texto) {
  if (!texto) return [null, null, null];
  if (_cache.has(texto)) return _cache.get(texto);
  const result = predictUncached(texto);
  if (_cache.size > 4096) _cache.clear();
  _cache.set(texto, result);
  return result;
}

function predictUncached(texto) {
  if (models) {
    const limpio = clean_text(texto);
    if (limpio) {
      const pick = (m) => {
        const p = predictProba(m, limpio);
        const i = p.indexOf(Math.max(...p));
        return p[i] >= UMBRAL_CONFIANZA ? m.classes[i] : null;
      };
      const proc = pick(models.proceso);
      const eje = pick(models.eje);
      let tema = pick(models.tema);
      if (eje && tema) {
        const e = /Eje\s*(\d+)/.exec(eje);
        const t = /^(\d+)\./.exec(tema);
        if (e && t && e[1] !== t[1]) tema = null;
      }
      if (proc && eje && tema) return [proc, eje, tema];
    }
  }
  return predecirPorPalabrasClave(texto);
}

// RNG determinista (mulberry32) para el split 80/20
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function trainModels() {
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    for (const p of Object.values(MODEL_PATHS)) {
      if (fs.existsSync(p)) {
        fs.copyFileSync(p, `${p}.bak`);
        logger.info(`📦 Backup guardado: ${p}.bak`);
      }
    }
    const all = await fetchAll((a, b) => supabase.from('variables').select('nombre,proceso,eje,tema').order('id').range(a, b));
    if (!all.length) return { status: 'error', message: 'No hay datos etiquetados para entrenar.' };
    let rows = all.filter((r) => r.nombre && r.proceso && r.eje && r.tema && String(r.nombre).trim());
    if (rows.length < 10) return { status: 'error', message: `Solo hay ${rows.length} filas etiquetadas. Se necesitan al menos 10.` };
    const consistent = rows.filter((r) => {
      const e = /Eje\s*(\d+)/.exec(r.eje);
      const t = /^(\d+)\./.exec(r.tema);
      return e && t && e[1] === t[1];
    });
    if (!consistent.length) {
      return { status: 'error', message: 'No hay filas con coherencia entre Eje y Tema. Corrige manualmente antes de reentrenar.' };
    }
    if (consistent.length < rows.length) logger.warn(`⚠️ Se descartaron ${rows.length - consistent.length} filas inconsistentes.`);
    rows = consistent;

    const X = rows.map((r) => clean_text(r.nombre));
    const idx = rows.map((_, i) => i);
    const rand = rng(42);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const nTest = Math.ceil(rows.length * 0.2);
    const test = idx.slice(0, nTest);
    const train = idx.slice(nTest);

    const report = {};
    for (const col of ['proceso', 'eje', 'tema']) {
      const y = rows.map((r) => r[col]);
      const model = fitPipeline(train.map((i) => X[i]), train.map((i) => y[i]));
      let ok = 0;
      for (const i of test) {
        const p = predictProba(model, X[i]);
        if (model.classes[p.indexOf(Math.max(...p))] === y[i]) ok++;
      }
      fs.writeFileSync(MODEL_PATHS[col], JSON.stringify(model));
      report[col] = { accuracy: test.length ? ok / test.length : 0, samples: test.length };
    }
    loadModels();
    return { status: 'success', message: `Modelos reentrenados con ${rows.length} filas consistentes.`, report };
  } catch (e) {
    return { status: 'error', message: e.message, traceback: e.stack };
  }
}

export function rollbackModels() {
  const restored = [];
  for (const p of Object.values(MODEL_PATHS)) {
    if (fs.existsSync(`${p}.bak`)) {
      fs.copyFileSync(`${p}.bak`, p);
      restored.push(p);
    }
  }
  if (restored.length) loadModels();
  return restored;
}

export function deleteModels() {
  const deleted = [];
  for (const p of Object.values(MODEL_PATHS)) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted.push(p);
    }
  }
  unloadModels();
  return deleted;
}
