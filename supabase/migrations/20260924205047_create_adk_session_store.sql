-- ADK workflow session store (pause/resume and execution state only; not a product data source).
-- Additive only: does not touch care_profiles / facilities.

create table public.adk_sessions (
  id text primary key,
  app_name text not null,
  user_id text not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adk_sessions_user_is_owner check (user_id = owner_id::text)
);

create index adk_sessions_owner_app_idx on public.adk_sessions (owner_id, app_name);

-- Whole ADK Event stored as JSONB so ADK 2.x event schema changes do not require migrations.
create table public.adk_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.adk_sessions (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id text not null,
  sequence_no bigint not null,
  event_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint adk_events_session_event_key unique (session_id, event_id),
  constraint adk_events_session_sequence_key unique (session_id, sequence_no)
);

create index adk_events_owner_idx on public.adk_events (owner_id);

alter table public.adk_sessions enable row level security;
alter table public.adk_events enable row level security;

revoke all on public.adk_sessions from anon;
revoke all on public.adk_events from anon;
grant select, insert, update, delete on public.adk_sessions to authenticated;
grant select, insert, update, delete on public.adk_events to authenticated;

create policy "Owners read own ADK sessions" on public.adk_sessions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners create own ADK sessions" on public.adk_sessions
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners update own ADK sessions" on public.adk_sessions
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete own ADK sessions" on public.adk_sessions
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners read own ADK events" on public.adk_events
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners create own ADK events" on public.adk_events
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners update own ADK events" on public.adk_events
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete own ADK events" on public.adk_events
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Appends (or replaces) one event and merges the session-state delta atomically.
-- SECURITY INVOKER: runs under the caller's RLS.
create function public.adk_append_event(
  p_session_id text,
  p_event_id text,
  p_event jsonb,
  p_state_delta jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sequence bigint;
begin
  update public.adk_sessions
  set state = state || coalesce(p_state_delta, '{}'::jsonb),
      updated_at = now()
  where id = p_session_id;
  if not found then
    raise exception 'ADK session % not found', p_session_id using errcode = 'P0002';
  end if;

  insert into public.adk_events (session_id, event_id, sequence_no, event_json)
  values (
    p_session_id,
    p_event_id,
    (select coalesce(max(e.sequence_no), 0) + 1 from public.adk_events e where e.session_id = p_session_id),
    p_event
  )
  on conflict (session_id, event_id) do update set event_json = excluded.event_json
  returning sequence_no into v_sequence;

  return v_sequence;
end;
$$;

revoke execute on function public.adk_append_event(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.adk_append_event(text, text, jsonb, jsonb) to authenticated;
