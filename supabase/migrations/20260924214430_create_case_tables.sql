-- Case (product source of truth). Additive only; care_profiles / facilities untouched.
-- Template cases (demo_case_001) have owner_id NULL and are readable by signed-in users for cloning.

create table public.care_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  is_template boolean not null default false,
  template_key text unique,
  source_template_id uuid references public.care_cases (id),
  status text not null default 'interviewing'
    check (status in ('interviewing', 'collecting', 'proposing', 'awaiting_decision', 'selecting_provider', 'tasks_ready', 'closed')),
  adk_session_id text unique,
  location_city_code text,
  is_demo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_cases_owner_or_template check ((is_template and owner_id is null) or (not is_template and owner_id is not null))
);
create index care_cases_owner_idx on public.care_cases (owner_id, created_at desc);

-- Direct identifiers, logically separated from case facts. Never sent to Gemini.
create table public.case_identities (
  case_id uuid primary key references public.care_cases (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null,
  address_detail text,
  phone text,
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.care_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  kind text not null default 'text' check (kind in ('text', 'question', 'answer', 'proposal', 'provider_list', 'tasks', 'notice')),
  content text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint care_messages_idem_key unique (case_id, idempotency_key)
);
create index care_messages_case_idx on public.care_messages (case_id, created_at);

-- Structured facts about the person/family; history kept, latest row per key is current.
create table public.case_facts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  fact_key text not null,
  value jsonb,
  value_status text not null default 'known' check (value_status in ('known', 'unknown')),
  source text not null check (source in ('registered_profile', 'catalog_answer', 'user_message', 'agent_inferred')),
  confidence numeric check (confidence between 0 and 1),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint case_facts_idem_key unique (case_id, idempotency_key)
);
create index case_facts_case_key_idx on public.case_facts (case_id, fact_key, created_at desc);

create table public.case_preferences (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  preference_key text not null,
  value jsonb not null,
  holder text not null default 'person' check (holder in ('person', 'family')),
  source text not null check (source in ('registered_profile', 'catalog_answer', 'user_message', 'agent_inferred')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint case_preferences_idem_key unique (case_id, idempotency_key)
);
create index case_preferences_case_key_idx on public.case_preferences (case_id, preference_key, created_at desc);

-- Latest value per key (security_invoker so RLS of the caller applies).
create view public.case_facts_current with (security_invoker = true) as
  select distinct on (case_id, fact_key) *
  from public.case_facts
  order by case_id, fact_key, created_at desc;

create view public.case_preferences_current with (security_invoker = true) as
  select distinct on (case_id, preference_key) *
  from public.case_preferences
  order by case_id, preference_key, created_at desc;

-- Append-only budget ledger (no update/delete policies, so users cannot reset their own budget).
create table public.case_usage (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('gemini_request', 'tool_call', 'web_search', 'question', 'proposal', 'user_message')),
  detail text,
  created_at timestamptz not null default now()
);
create index case_usage_case_kind_idx on public.case_usage (case_id, kind);

-- Append-only product analytics.
create table public.app_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  case_id uuid references public.care_cases (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index app_events_owner_type_idx on public.app_events (owner_id, event_type, created_at desc);

-- RLS -----------------------------------------------------------------------
alter table public.care_cases enable row level security;
alter table public.case_identities enable row level security;
alter table public.care_messages enable row level security;
alter table public.case_facts enable row level security;
alter table public.case_preferences enable row level security;
alter table public.case_usage enable row level security;
alter table public.app_events enable row level security;

revoke all on public.care_cases, public.case_identities, public.care_messages, public.case_facts,
  public.case_preferences, public.case_usage, public.app_events,
  public.case_facts_current, public.case_preferences_current from anon;

grant select, insert, update, delete on public.care_cases to authenticated;
grant select, insert on public.case_identities to authenticated;
grant select, insert on public.care_messages to authenticated;
grant select, insert on public.case_facts to authenticated;
grant select, insert on public.case_preferences to authenticated;
grant select, insert on public.case_usage to authenticated;
grant select, insert on public.app_events to authenticated;
grant select on public.case_facts_current, public.case_preferences_current to authenticated;

create policy "Read own or template cases" on public.care_cases
  for select to authenticated using (owner_id = (select auth.uid()) or is_template);
create policy "Create own cases" on public.care_cases
  for insert to authenticated with check (owner_id = (select auth.uid()) and not is_template);
create policy "Update own cases" on public.care_cases
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and not is_template);
create policy "Delete own cases" on public.care_cases
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Child tables: own rows (inserts must target an own case); template rows readable for cloning.
create policy "Read own or template identities" on public.case_identities
  for select to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.care_cases c where c.id = case_id and c.is_template));
create policy "Create own identities" on public.case_identities
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own messages" on public.care_messages
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own messages" on public.care_messages
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own or template facts" on public.case_facts
  for select to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.care_cases c where c.id = case_id and c.is_template));
create policy "Create own facts" on public.case_facts
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own or template preferences" on public.case_preferences
  for select to authenticated using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.care_cases c where c.id = case_id and c.is_template));
create policy "Create own preferences" on public.case_preferences
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own usage" on public.case_usage
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Record own usage" on public.case_usage
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own app events" on public.app_events
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Record own app events" on public.app_events
  for insert to authenticated with check (owner_id = (select auth.uid()));

-- Link ADK sessions to cases (ADK tables stay execution-state only).
alter table public.adk_sessions add column case_id uuid references public.care_cases (id) on delete cascade;
create index adk_sessions_case_idx on public.adk_sessions (case_id);
