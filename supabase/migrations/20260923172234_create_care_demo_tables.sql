-- Demo tables for the AI care-facility selection MVP (fictional data only)
create table public.care_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  age integer not null check (age between 0 and 130),
  care_level text not null,
  dementia text not null,
  mobility text not null,
  bathing text not null,
  toileting text not null,
  medication text not null,
  chronic_conditions text not null,
  medical_needs text not null,
  preferred_area text not null,
  budget_min_yen integer not null check (budget_min_yen >= 0),
  budget_max_yen integer not null check (budget_max_yen >= budget_min_yen),
  wants_private_room boolean not null,
  family_access_priority text not null,
  person_wishes text not null,
  family_wishes text not null,
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  facility_type text not null,
  monthly_fee_yen integer not null check (monthly_fee_yen >= 0),
  entrance_fee_yen integer not null check (entrance_fee_yen >= 0),
  accepted_care_levels text not null,
  dementia_support text not null,
  medical_support text not null,
  private_room boolean not null,
  rehabilitation text not null,
  family_access text not null,
  features text not null,
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.care_profiles enable row level security;
alter table public.facilities enable row level security;

-- Read-only public access: demo data is fictional and there is no login in this MVP.
grant select on public.care_profiles to anon, authenticated;
grant select on public.facilities to anon, authenticated;

create policy "Demo profiles are readable"
  on public.care_profiles for select
  to anon, authenticated
  using (is_demo);

create policy "Demo facilities are readable"
  on public.facilities for select
  to anon, authenticated
  using (is_demo);
