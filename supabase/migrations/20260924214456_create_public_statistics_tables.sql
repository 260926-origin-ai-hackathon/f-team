-- Public statistics catalog (aggregate tables only). Additive only.
-- K25 / C26 / S22 / S24 are aggregate statistics, not microdata. Each table has its own dimensions.
-- Never join observations from different stat_tables to build a synthetic person.

create table public.stat_datasets (
  id uuid primary key default gen_random_uuid(),
  dataset_code text not null unique,
  dataset_name text not null,
  survey_year integer,
  release_date date,
  source_type text not null default 'official_aggregate_statistics',
  source_note text,
  is_demo boolean not null default true
);

create table public.stat_tables (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.stat_datasets (id) on delete cascade,
  table_code text not null unique,
  table_number integer, -- NULL when no official table number applies (e.g. demo-only structures)
  title text not null,
  dimension_keys text[] not null,
  population_definition text not null,
  measure_definition text not null,
  multiple_response boolean not null default false,
  source_note text,
  is_demo boolean not null default true
);

-- One aggregate cell of one table. NOT a person record.
create table public.stat_observations (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.stat_tables (id) on delete cascade,
  dimensions jsonb not null,
  measure text not null,
  value numeric not null,
  unit text not null,
  annotation text,
  is_demo boolean not null default true
);
comment on table public.stat_observations is
  'Aggregate statistical cell (e.g. count of people in a cross-tab cell). Never a person record; never join across stat_tables.';
create index stat_observations_table_idx on public.stat_observations (table_id);
create index stat_observations_dimensions_idx on public.stat_observations using gin (dimensions);

-- Guard: an observation may only use the dimensions declared by its own table.
create function public.stat_observations_check_dimensions() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_keys text[];
begin
  select t.dimension_keys into v_keys from public.stat_tables t where t.id = new.table_id;
  if exists (select 1 from jsonb_object_keys(new.dimensions) k where not (k = any (v_keys))) then
    raise exception 'dimensions % not declared by stat table %', new.dimensions, new.table_id;
  end if;
  return new;
end;
$$;
create trigger stat_observations_check_dimensions
  before insert or update on public.stat_observations
  for each row execute function public.stat_observations_check_dimensions();

alter table public.stat_datasets enable row level security;
alter table public.stat_tables enable row level security;
alter table public.stat_observations enable row level security;

revoke all on public.stat_datasets, public.stat_tables, public.stat_observations from anon;
grant select on public.stat_datasets, public.stat_tables, public.stat_observations to authenticated;

create policy "Reference data is readable" on public.stat_datasets for select to authenticated using (true);
create policy "Reference data is readable" on public.stat_tables for select to authenticated using (true);
create policy "Reference data is readable" on public.stat_observations for select to authenticated using (true);
