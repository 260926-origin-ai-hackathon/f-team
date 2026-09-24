-- Service knowledge (read-only reference data). Additive only.

create table public.care_services (
  code text primary key,
  name text not null,
  category text not null check (category in ('home_visit', 'day_service', 'short_stay', 'community_multi', 'residential')),
  description text not null,
  is_demo boolean not null default true
);

-- Consultations / applications are not care services (e.g. care-level certification, community support center).
create table public.care_actions (
  code text primary key,
  name text not null,
  action_type text not null check (action_type in ('consultation', 'application')),
  description text not null,
  is_demo boolean not null default true
);

-- Service concepts as each dataset names them (K25 "訪問系", C26 "訪問介護", P26 "110", ...).
create table public.source_service_concepts (
  id uuid primary key default gen_random_uuid(),
  dataset_code text not null,
  concept_code text not null,
  concept_label text not null,
  notes text,
  is_demo boolean not null default true,
  constraint source_service_concepts_key unique (dataset_code, concept_code)
);

create table public.service_mappings (
  id uuid primary key default gen_random_uuid(),
  source_concept_id uuid not null references public.source_service_concepts (id) on delete cascade,
  service_code text not null references public.care_services (code),
  relation text not null check (relation in ('exact_match', 'broader_than', 'narrower_than', 'related_to')),
  notes text,
  is_demo boolean not null default true,
  constraint service_mappings_key unique (source_concept_id, service_code, relation)
);

-- A: institutional eligibility / preconditions (rule-evaluated, not LLM-judged).
create table public.eligibility_rules (
  rule_id text primary key,
  target_service_code text references public.care_services (code),
  target_action_code text references public.care_actions (code),
  condition jsonb not null,
  effect text not null check (effect in ('eligible', 'not_eligible_in_principle', 'requires_check', 'recommend_action')),
  explanation text not null,
  source text not null,
  caveat text not null,
  is_demo_rule boolean not null default true,
  constraint eligibility_rules_target check ((target_service_code is null) <> (target_action_code is null))
);

-- B: life needs -> candidate services/actions (suitability knowledge, separate from eligibility).
create table public.need_service_mappings (
  id uuid primary key default gen_random_uuid(),
  need_code text not null,
  need_label text not null,
  service_code text references public.care_services (code),
  action_code text references public.care_actions (code),
  strength text not null check (strength in ('primary', 'secondary')),
  rationale text not null,
  is_demo boolean not null default true,
  constraint need_service_mappings_target check ((service_code is null) <> (action_code is null)),
  constraint need_service_mappings_key unique (need_code, service_code, action_code)
);

alter table public.care_services enable row level security;
alter table public.care_actions enable row level security;
alter table public.source_service_concepts enable row level security;
alter table public.service_mappings enable row level security;
alter table public.eligibility_rules enable row level security;
alter table public.need_service_mappings enable row level security;

revoke all on public.care_services, public.care_actions, public.source_service_concepts,
  public.service_mappings, public.eligibility_rules, public.need_service_mappings from anon;
grant select on public.care_services, public.care_actions, public.source_service_concepts,
  public.service_mappings, public.eligibility_rules, public.need_service_mappings to authenticated;

create policy "Reference data is readable" on public.care_services for select to authenticated using (true);
create policy "Reference data is readable" on public.care_actions for select to authenticated using (true);
create policy "Reference data is readable" on public.source_service_concepts for select to authenticated using (true);
create policy "Reference data is readable" on public.service_mappings for select to authenticated using (true);
create policy "Reference data is readable" on public.eligibility_rules for select to authenticated using (true);
create policy "Reference data is readable" on public.need_service_mappings for select to authenticated using (true);
