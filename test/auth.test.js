// Compatibilidad con hashes de Werkzeug generados por Flask (generate_password_hash).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPasswordHash, generatePasswordHash } from '../src/auth.js';

const SCRYPT = 'scrypt:32768:8:1$v1GjqxQrJortaw6u$60b44b3023fe1dce0751e0f1b155635bc2e24f90c4d305952a288b71feb181d2c8671d7dd91000a99cc98864e77ba1ae773e708afe17bba5707a19dc9e453384';
const PBKDF2 = 'pbkdf2:sha256:600000$6WEdBgMi5IS5c8vB$a871d6ae052ea3dc63d727653f9ac27da29ba6f17850523dcf71ebb8cd59d2e9';

test('verifica hash scrypt de Werkzeug', async () => {
  assert.equal(await checkPasswordHash(SCRYPT, 'secreto1'), true);
  assert.equal(await checkPasswordHash(SCRYPT, 'otra'), false);
});

test('verifica hash pbkdf2 de Werkzeug', async () => {
  assert.equal(await checkPasswordHash(PBKDF2, 'secreto1'), true);
  assert.equal(await checkPasswordHash(PBKDF2, 'otra'), false);
});

test('los hashes generados son verificables y con formato Werkzeug', async () => {
  const h = await generatePasswordHash('clave-nueva');
  assert.match(h, /^scrypt:32768:8:1\$[A-Za-z0-9]{16}\$[0-9a-f]{128}$/);
  assert.equal(await checkPasswordHash(h, 'clave-nueva'), true);
  assert.equal(await checkPasswordHash(h, 'x'), false);
});

test('hashes inválidos devuelven false', async () => {
  assert.equal(await checkPasswordHash('basura', 'x'), false);
  assert.equal(await checkPasswordHash('md5$a$b', 'x'), false);
});
