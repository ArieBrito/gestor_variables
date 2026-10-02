// Crea / actualiza la infraestructura de datos en Supabase (db/schema.sql).
//
// Estrategias (en orden; la primera que funcione gana):
//   1) Postgres directo       -> DATABASE_URL            (requiere IPv6 o add-on IPv4)
//   2) Pooler de Supabase     -> DATABASE_URL (user/pass) contra aws-{0,1}-<region>.pooler.supabase.com
//   3) Management API (HTTPS) -> SUPABASE_ACCESS_TOKEN   (token personal "sbp_...")
//
// Uso:  npm run db:setup            (aplica db/schema.sql y verifica)
//       npm run db:setup -- --check (solo verifica, no modifica)
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const CHECK_ONLY = process.argv.includes('--check');
const sqlPath = new URL('../db/schema.sql', import.meta.url);
const SQL = fs.readFileSync(sqlPath, 'utf8');

const need = (k) => {
  if (!process.env[k]) throw new Error(`Falta ${k} en .env`);
  return process.env[k];
};
const SUPABASE_URL = need('SUPABASE_URL');
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const TABLES = ['variables', 'usuarios', 'cargas', 'proceso', 'eje', 'tema', 'cobertura', 'periodicidad', 'estado'];

const log = (...a) => console.log(...a);

async function runWithPg(clientConfig, label) {
  const c = new pg.Client({ ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000, ...clientConfig });
  await c.connect();
  try {
    await c.query(SQL);
  } finally {
    await c.end();
  }
  log(`✅ Esquema aplicado vía ${label}`);
}

async function viaDirect() {
  if (!process.env.DATABASE_URL) throw new Error('sin DATABASE_URL');
  await runWithPg({ connectionString: process.env.DATABASE_URL }, 'Postgres directo');
}

async function viaPooler() {
  if (!process.env.DATABASE_URL) throw new Error('sin DATABASE_URL');
  const u = new URL(process.env.DATABASE_URL);
  const password = decodeURIComponent(u.password);
  const regions = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
    'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
    'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  ];
  const candidates = ['aws-0', 'aws-1'].flatMap((p) => regions.map((r) => `${p}-${r}.pooler.supabase.com`));
  const results = await Promise.all(
    candidates.map(async (host) => {
      const c = new pg.Client({
        host, port: 5432, user: `postgres.${REF}`, password, database: 'postgres',
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
      });
      try {
        await c.connect();
        await c.end();
        return host;
      } catch {
        return null;
      }
    })
  );
  const host = results.find(Boolean);
  if (!host) throw new Error('ningún pooler alcanzable (¿puerto 5432 bloqueado?)');
  await runWithPg({ host, port: 5432, user: `postgres.${REF}`, password, database: 'postgres' }, `pooler ${host}`);
}

async function viaManagementApi() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('sin SUPABASE_ACCESS_TOKEN');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${body.slice(0, 300)}`);
  log('✅ Esquema aplicado vía Management API');
}

export async function verify() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const missing = [];
  const counts = {};
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact' }).limit(1);
    if (error) missing.push(`${t} (${error.code || error.message})`);
    else counts[t] = count;
  }
  return { missing, counts };
}

async function main() {
  log(`🔧 Proyecto Supabase: ${REF}`);
  let { missing, counts } = await verify();
  if (!missing.length) {
    log('✅ Todas las tablas ya existen:', counts);
    if (CHECK_ONLY) return;
  } else {
    log(`ℹ️  Tablas faltantes: ${missing.join(', ')}`);
    if (CHECK_ONLY) process.exit(1);
  }

  const errors = [];
  for (const [name, fn] of [['directo', viaDirect], ['pooler', viaPooler], ['management-api', viaManagementApi]]) {
    try {
      await fn();
      errors.length = 0;
      break;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      log(`   · ${name} no disponible: ${e.message}`);
    }
  }
  if (errors.length === 3) {
    console.error(`
❌ No se pudo aplicar el esquema automáticamente desde esta red.
   Opciones:
   A) Abre Supabase > SQL Editor y pega el contenido de db/schema.sql (idempotente).
   B) Crea un token personal en https://supabase.com/dashboard/account/tokens,
      agrégalo a .env como SUPABASE_ACCESS_TOKEN=sbp_... y reintenta  npm run db:setup
   C) Ejecuta  npm run db:setup  desde una red con IPv6 / puerto 5432 abierto.`);
    process.exit(2);
  }

  ({ missing, counts } = await verify());
  if (missing.length) {
    console.error('❌ Verificación fallida; faltan:', missing);
    process.exit(3);
  }
  log('✅ Verificación OK (filas por tabla):', counts);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
