// Genera db/schema.sql (esquema + catálogos iniciales) a partir de src/constants.js.
// Uso: node scripts/build-schema.js
import fs from 'node:fs';
import { KEYWORDS, CODIGO_ESTADO_A_NOMBRE } from '../src/constants.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const seed = (table, names) =>
  `insert into public.${table} (name) values\n  ${names.map((n) => `(${q(n)})`).join(',\n  ')}\non conflict (name) do nothing;\n`;

const catalogs = {
  proceso: Object.keys(KEYWORDS.proceso),
  eje: Object.keys(KEYWORDS.eje),
  tema: Object.keys(KEYWORDS.tema),
  cobertura: ['Federal', 'Estatal', 'Municipal'],
  periodicidad: ['Anual', 'Semestral', 'Trimestral', 'Mensual'],
  estado: [...Object.values(CODIGO_ESTADO_A_NOMBRE), 'No aplica'],
};

const sql = `-- =============================================================================
-- Gestor de Variables – SESNA · Esquema de base de datos (Supabase / PostgreSQL)
-- Generado por scripts/build-schema.js · Idempotente (se puede ejecutar varias veces)
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Tabla principal: variables (jerarquía padre/hijo por parent_id)
-- ---------------------------------------------------------------------------
create table if not exists public.variables (
  id            text primary key,                       -- formato 'A-00001'
  proceso       text,
  eje           text,
  tema          text,
  nombre        text,
  institucion   text,
  cobertura     text,
  periodicidad  text,
  liga_web      text,
  fuente        text,
  "año"         text,
  estado        text,
  valor         text,                                   -- texto: admite NSS / NA / No aplica
  parent_id     text references public.variables(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index if not exists variables_parent_id_idx on public.variables (parent_id);
create index if not exists variables_parent_null_idx on public.variables (id) where parent_id is null;
create index if not exists variables_nombre_trgm_idx on public.variables using gin (nombre extensions.gin_trgm_ops);
create index if not exists variables_fuente_trgm_idx on public.variables using gin (fuente extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Usuarios (autenticación de la app; password_hash con formato Werkzeug/scrypt)
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique,
  password_hash  text not null,
  rol            text not null default 'user' check (rol in ('admin', 'user')),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Historial de cargas (CSV / ZIP)
-- ---------------------------------------------------------------------------
create table if not exists public.cargas (
  id               bigint generated always as identity primary key,
  fecha            timestamptz not null default now(),
  archivo          text,
  filas_agregadas  integer not null default 0,
  estado           text                                  -- 'completado' | 'error'
);
create index if not exists cargas_fecha_idx on public.cargas (fecha desc);

-- ---------------------------------------------------------------------------
-- 4. Catálogos (listas desplegables y normalización): columna 'name'
-- ---------------------------------------------------------------------------
${Object.keys(catalogs)
  .map(
    (t) => `create table if not exists public.${t} (
  id    bigint generated always as identity primary key,
  name  text not null unique
);`
  )
  .join('\n')}

-- ---------------------------------------------------------------------------
-- 5. Seguridad: RLS activado SIN políticas => la llave publicable (anon) no puede
--    leer ni escribir nada. El backend usa la service_role (omite RLS).
-- ---------------------------------------------------------------------------
${['variables', 'usuarios', 'cargas', ...Object.keys(catalogs)]
  .map((t) => `alter table public.${t} enable row level security;`)
  .join('\n')}

-- ---------------------------------------------------------------------------
-- 6. Datos iniciales de catálogos
-- ---------------------------------------------------------------------------
${Object.entries(catalogs)
  .map(([t, names]) => seed(t, names))
  .join('\n')}
-- Recargar el caché de esquema de PostgREST
notify pgrst, 'reload schema';
`;

fs.writeFileSync(new URL('../db/schema.sql', import.meta.url), sql, 'utf8');
console.log('db/schema.sql generado (' + sql.length + ' bytes)');
