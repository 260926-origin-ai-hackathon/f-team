-- Recommendation and care-task tables. Additive only.

create table public.proposal_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round integer not null check (round >= 1),
  status text not null default 'collecting' check (status in ('collecting', 'completed', 'failed')),
  agent2_control jsonb, -- Agent② control output only (tools called, gaps, web need); never tool values
  summary text,
  created_at timestamptz not null default now(),
  constraint proposal_runs_case_round_key unique (case_id, round)
);

-- Typed tool results saved directly from tool return values: the source of truth for proposals.
create table public.proposal_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.proposal_runs (id) on delete cascade,
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tool_name text not null,
  tool_args jsonb not null default '{}'::jsonb,
  result jsonb not null,
  status text not null check (status in ('ok', 'empty', 'error', 'skipped')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint proposal_sources_idem_key unique (run_id, idempotency_key)
);
create index proposal_sources_case_idx on public.proposal_sources (case_id, created_at);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.proposal_runs (id) on delete cascade,
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rank integer not null,
  target_type text not null check (target_type in ('service', 'action')),
  target_code text not null,
  title text not null,
  content jsonb not null,
  decision text check (decision in ('accepted', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint proposals_run_rank_key unique (run_id, rank)
);
create index proposals_case_idx on public.proposals (case_id, created_at);

create table public.task_templates (
  id text primary key,
  target_type text not null check (target_type in ('service', 'action')),
  target_code text not null,
  title text not null,
  steps jsonb not null, -- [{step_id, title, detail, requires_official_check}]
  caveat text not null,
  is_demo boolean not null default true,
  constraint task_templates_target_key unique (target_type, target_code)
);

create table public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  proposal_id uuid references public.proposals (id) on delete set null,
  template_id text references public.task_templates (id),
  provider_id uuid references public.providers (provider_id),
  step_id text not null,
  title text not null,
  detail text,
  requires_official_check boolean not null default false,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  sort_order integer not null default 0,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_tasks_idem_key unique (case_id, idempotency_key)
);
create index case_tasks_case_idx on public.case_tasks (case_id, sort_order);

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.case_tasks (id) on delete cascade,
  case_id uuid not null references public.care_cases (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now()
);

alter table public.proposal_runs enable row level security;
alter table public.proposal_sources enable row level security;
alter table public.proposals enable row level security;
alter table public.task_templates enable row level security;
alter table public.case_tasks enable row level security;
alter table public.task_events enable row level security;

revoke all on public.proposal_runs, public.proposal_sources, public.proposals,
  public.task_templates, public.case_tasks, public.task_events from anon;
grant select, insert, update on public.proposal_runs to authenticated;
grant select, insert on public.proposal_sources to authenticated;
grant select, insert, update on public.proposals to authenticated;
grant select on public.task_templates to authenticated;
grant select, insert, update on public.case_tasks to authenticated;
grant select, insert on public.task_events to authenticated;

create policy "Read own proposal runs" on public.proposal_runs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own proposal runs" on public.proposal_runs
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));
create policy "Update own proposal runs" on public.proposal_runs
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "Read own proposal sources" on public.proposal_sources
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own proposal sources" on public.proposal_sources
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));

create policy "Read own proposals" on public.proposals
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own proposals" on public.proposals
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));
create policy "Update own proposals" on public.proposals
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "Reference data is readable" on public.task_templates for select to authenticated using (true);

create policy "Read own tasks" on public.case_tasks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own tasks" on public.case_tasks
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));
create policy "Update own tasks" on public.case_tasks
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "Read own task events" on public.task_events
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own task events" on public.task_events
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.care_cases c where c.id = case_id and c.owner_id = (select auth.uid())));
