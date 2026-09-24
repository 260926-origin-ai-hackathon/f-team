-- Typed search functions used by tools (no free-form SQL from the LLM). SECURITY INVOKER.

-- Providers offering any of the given canonical services near a municipality's representative point.
-- distance_km is a reference distance from that point, not from the person's home.
create function public.search_providers(
  p_care_service_codes text[],
  p_city_code text,
  p_radius_km numeric default 10,
  p_limit integer default 10
) returns table (
  provider_id uuid,
  provider_code text,
  provider_name text,
  service_code text,
  service_name text,
  city text,
  address text,
  capacity integer,
  summary text,
  phone_display text,
  website text,
  care_service_codes text[],
  distance_km numeric,
  origin_label text,
  is_demo boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with origin as (
    select r.location, r.label from public.city_reference_points r where r.city_code = p_city_code
  )
  select
    p.provider_id, p.provider_code, p.provider_name, p.service_code, p.service_name, p.city, p.address,
    p.capacity, p.summary, p.phone_display, p.website,
    array(select ps2.care_service_code from public.provider_services ps2 where ps2.provider_id = p.provider_id order by 1),
    round((extensions.st_distance(p.location, o.location) / 1000)::numeric, 1),
    o.label,
    p.is_demo
  from public.providers p
  cross join origin o
  where exists (
      select 1 from public.provider_services ps
      where ps.provider_id = p.provider_id and ps.care_service_code = any (p_care_service_codes)
    )
    and extensions.st_dwithin(p.location, o.location, p_radius_km * 1000)
  order by extensions.st_distance(p.location, o.location)
  limit least(greatest(p_limit, 1), 50);
$$;

-- Hybrid search: PGroonga full-text + pgvector, fused with reciprocal rank fusion.
create function public.hybrid_search_documents(
  p_query text,
  p_query_embedding extensions.vector(768) default null,
  p_limit integer default 5
) returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  document_type text,
  content text,
  fts_rank integer,
  vector_rank integer,
  score double precision,
  is_demo boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with fts as (
    select c.id, row_number() over (order by extensions.pgroonga_score(c.tableoid, c.ctid) desc) as rnk
    from public.document_chunks c
    where c.content operator(extensions.&@~) extensions.pgroonga_query_escape(p_query)
    limit 20
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_query_embedding) as rnk
    from public.document_chunks c
    where p_query_embedding is not null and c.embedding is not null
    order by c.embedding operator(extensions.<=>) p_query_embedding
    limit 20
  ),
  fused as (
    select coalesce(f.id, v.id) as id, f.rnk as fts_rank, v.rnk as vector_rank,
           coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + v.rnk), 0) as score
    from fts f
    full outer join vec v on f.id = v.id
  )
  select c.id, d.id, d.title, d.document_type, c.content,
         fused.fts_rank::integer, fused.vector_rank::integer, fused.score::double precision, d.is_demo
  from fused
  join public.document_chunks c on c.id = fused.id
  join public.knowledge_documents d on d.id = c.document_id
  order by fused.score desc
  limit least(greatest(p_limit, 1), 20);
$$;

revoke execute on function public.search_providers(text[], text, numeric, integer) from public, anon;
revoke execute on function public.hybrid_search_documents(text, extensions.vector, integer) from public, anon;
grant execute on function public.search_providers(text[], text, numeric, integer) to authenticated;
grant execute on function public.hybrid_search_documents(text, extensions.vector, integer) to authenticated;
