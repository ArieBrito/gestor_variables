// Pipeline ZIP de extremo a extremo con un ZIP sintético (sin depender de Supabase).
import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { processZipFile } from '../src/processing/folder.js';
import { computeRowHash } from '../src/hash.js';
import { predictCategories } from '../src/ml.js';
import { normalizarNumeroTexto } from '../src/normalize.js';

function buildZip() {
  const zip = new AdmZip();
  zip.addFile('conjunto_de_datos/0_indice.csv', Buffer.from('ARCHIVO,CONTENIDO\nm1s5p1_cnge2025.csv,Denuncias recibidas por autoridad\n'));
  zip.addFile(
    'conjunto_de_datos/m1s5p1_cnge2025.csv',
    Buffer.from('CVE_ENT,AUTOINST,TOTAL\n01,1,10\n01,2,5\n02,1,7\n02,2,3\n')
  );
  zip.addFile(
    'diccionario_de_datos/diccionario_de_datos_m1s5p1_cnge2025.csv',
    Buffer.from('Columna,Descripcion,Tipo_Dato\nCVE_ENT,Clave del AGEE,Carácter\nAUTOINST,Institución,Carácter\nTOTAL,Total de denuncias,Numérico\n'.replace('Numérico', 'Carácter'))
  );
  zip.addFile('catalogos/autoinst.csv', Buffer.from('autoinst,nombre\n1,Secretaría A\n2,Secretaría B\n'));
  zip.addFile('metadatos/metadatos.txt', Buffer.from('Title: Censo Nacional de Gobierno Federal 2025\nSpatial: Estados Unidos Mexicanos\nAccrualPeriodicity: Anual\n'));
  return zip.toBuffer();
}

test('normalizarNumeroTexto', () => {
  assert.equal(normalizarNumeroTexto('2024.0', 'año'), '2024');
  assert.equal(normalizarNumeroTexto(12, 'valor'), '12.0');
  assert.equal(normalizarNumeroTexto('NSS', 'valor'), 'NSS');
});

test('hash estable ante el origen del valor', () => {
  const a = computeRowHash({ nombre: 'x', valor: 10, año: 2024 });
  const b = computeRowHash({ nombre: 'x', valor: '10.0', año: '2024' });
  assert.equal(a, b);
});

test('predictCategories no falla sin modelos', () => {
  assert.equal(predictCategories('').length, 3);
  assert.equal(predictCategories('denuncias de corrupción').length, 3);
});

test('procesa un ZIP y genera padres e hijos', async () => {
  const log = [];
  const r = await processZipFile(buildZip(), 'demo.zip', log);
  const parents = r.rowStatus.filter((x) => x._is_parent);
  const children = r.rowStatus.filter((x) => x._is_child);
  assert.ok(parents.length >= 1, log.join('\n'));
  assert.ok(children.length >= 4, `hijos: ${children.length}\n${log.slice(-25).join('\n')}`);
  const total = parents.find((p) => p.data.nombre.includes('Denuncias'));
  assert.ok(total, 'padre con nombre del índice');
  assert.equal(Number(total.data.valor), 25);
  assert.ok(children.every((c) => parents.some((p) => p._hash === c._parent_hash)));
  assert.equal(parents[0].data.cobertura, 'Federal');
  assert.equal(parents[0].data.año, '2025');
});
