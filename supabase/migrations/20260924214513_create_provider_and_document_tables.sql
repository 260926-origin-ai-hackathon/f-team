-- Providers (P26-like directory) and documents for hybrid search. Additive only.

-- Representative point per municipality (distance origin; exact home location is never stored here).
create table public.city_reference_points (
  city_code text primary key,
  prefecture text not null,
  city text not null,
  label text not null,
  location extensions.geography(Point, 4326) not null
);

create table public.providers (
  provider_id uuid primary key default gen_random_uuid(),
  provider_code text not null unique,
  provider_name text not null,
  service_code text not null, -- P26 service type code (e.g. 110 訪問介護)
  service_name text not null,
  prefecture text not null,
  city text not null,
  city_code text not null,
  address text not null,
  location extensions.geography(Point, 4326) not null,
  phone_display text not null default 'デモ用（架空）',
  capacity integer,
  website text,
  summary text not null,
  is_demo boolean not null default true,
  constraint providers_demo_code check (not is_demo or provider_code like 'DEMO-%')
);
create index providers_location_idx on public.providers using gist (location);
create index providers_service_code_idx on public.providers (service_code);

-- Provider -> canonical care service mapping.
create table public.provider_services (
  provider_id uuid not null references public.providers (provider_id) on delete cascade,
  care_service_code text not null references public.care_services (code),
  primary key (provider_id, care_service_code)
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text not null check (document_type in ('service_guide', 'procedure', 'facility_intro')),
  source_type text not null default 'demo_authored',
  source_url text,
  body text not null,
  is_demo boolean not null default true
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768),
  constraint document_chunks_key unique (document_id, chunk_index)
);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_content_pgroonga_idx on public.document_chunks using pgroonga (content);

alter table public.city_reference_points enable row level security;
alter table public.providers enable row level security;
alter table public.provider_services enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.document_chunks enable row level security;

revoke all on public.city_reference_points, public.providers, public.provider_services,
  public.knowledge_documents, public.document_chunks from anon;
grant select on public.city_reference_points, public.providers, public.provider_services,
  public.knowledge_documents, public.document_chunks to authenticated;

create policy "Reference data is readable" on public.city_reference_points for select to authenticated using (true);
create policy "Reference data is readable" on public.providers for select to authenticated using (true);
create policy "Reference data is readable" on public.provider_services for select to authenticated using (true);
create policy "Reference data is readable" on public.knowledge_documents for select to authenticated using (true);
create policy "Reference data is readable" on public.document_chunks for select to authenticated using (true);
