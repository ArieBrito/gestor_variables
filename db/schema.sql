-- =============================================================================
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
create table if not exists public.proceso (
  id    bigint generated always as identity primary key,
  name  text not null unique
);
create table if not exists public.eje (
  id    bigint generated always as identity primary key,
  name  text not null unique
);
create table if not exists public.tema (
  id    bigint generated always as identity primary key,
  name  text not null unique
);
create table if not exists public.cobertura (
  id    bigint generated always as identity primary key,
  name  text not null unique
);
create table if not exists public.periodicidad (
  id    bigint generated always as identity primary key,
  name  text not null unique
);
create table if not exists public.estado (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

-- ---------------------------------------------------------------------------
-- 5. Seguridad: RLS activado SIN políticas => la llave publicable (anon) no puede
--    leer ni escribir nada. El backend usa la service_role (omite RLS).
-- ---------------------------------------------------------------------------
alter table public.variables enable row level security;
alter table public.usuarios enable row level security;
alter table public.cargas enable row level security;
alter table public.proceso enable row level security;
alter table public.eje enable row level security;
alter table public.tema enable row level security;
alter table public.cobertura enable row level security;
alter table public.periodicidad enable row level security;
alter table public.estado enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Datos iniciales de catálogos
-- ---------------------------------------------------------------------------
insert into public.proceso (name) values
  ('A. Prevención'),
  ('B. Detección'),
  ('C. Sanción'),
  ('D. Fiscalización y control de recursos')
on conflict (name) do nothing;

insert into public.eje (name) values
  ('1. Combatir la corrupción y la impunidad'),
  ('2. Combatir la arbitrariedad y el abuso de poder'),
  ('3. Promover la mejora de la gestión y los puntos de contacto gobierno-sociedad'),
  ('4. Involucrar a la sociedad y el sector privado')
on conflict (name) do nothing;

insert into public.tema (name) values
  ('1.1. Prevención, detección, denuncia, investigación, substanciación y sanción de faltas administrativas'),
  ('1.2. Procuración e impartición de justicia en materia de delitos por hechos de corrupción'),
  ('2.1. Profesionalización e integridad en el servicio público'),
  ('2.2. Procesos institucionales'),
  ('2.3. Auditoría y fiscalización'),
  ('3.1. Puntos de contacto gobierno-ciudadanía: trámites, servicios y programas públicos'),
  ('3.2. Puntos de contacto gobierno-iniciativa privada'),
  ('4.1. Participación ciudadana: vigilancia, colaboración y cocreación'),
  ('4.2. Corresponsabilidad e integridad empresarial'),
  ('4.3. Educación y comunicación para el control de la corrupción')
on conflict (name) do nothing;

insert into public.cobertura (name) values
  ('Federal'),
  ('Estatal'),
  ('Municipal')
on conflict (name) do nothing;

insert into public.periodicidad (name) values
  ('Anual'),
  ('Semestral'),
  ('Trimestral'),
  ('Mensual')
on conflict (name) do nothing;

insert into public.estado (name) values
  ('Durango'),
  ('Guanajuato'),
  ('Guerrero'),
  ('Hidalgo'),
  ('Jalisco'),
  ('México'),
  ('Michoacán de Ocampo'),
  ('Morelos'),
  ('Nayarit'),
  ('Nuevo León'),
  ('Oaxaca'),
  ('Puebla'),
  ('Querétaro'),
  ('Quintana Roo'),
  ('San Luis Potosí'),
  ('Sinaloa'),
  ('Sonora'),
  ('Tabasco'),
  ('Tamaulipas'),
  ('Tlaxcala'),
  ('Veracruz de Ignacio de la Llave'),
  ('Yucatán'),
  ('Zacatecas'),
  ('Aguascalientes'),
  ('Baja California'),
  ('Baja California Sur'),
  ('Campeche'),
  ('Coahuila de Zaragoza'),
  ('Colima'),
  ('Chiapas'),
  ('Chihuahua'),
  ('Ciudad de México'),
  ('No aplica')
on conflict (name) do nothing;

-- Recargar el caché de esquema de PostgREST
notify pgrst, 'reload schema';
