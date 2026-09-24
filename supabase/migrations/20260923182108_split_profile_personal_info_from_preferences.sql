-- care_profiles holds only information already registered about the person.
-- Facility-search preferences (budget, area, room, access, wishes) are asked in the app instead.
alter table public.care_profiles
  add column gender text,
  add column address text,
  add column household text,
  add column residence text,
  add column emergency_contact text,
  add column eating text,
  add column daytime_life text,
  add column care_services text,
  add column medications text,
  add column allergies text;

update public.care_profiles
set
  gender = '女性',
  address = '大阪府吹田市',
  household = '一人暮らし（長男は大阪府内に居住）',
  residence = '自宅',
  emergency_contact = '長男',
  eating = '自立',
  daytime_life = '自宅中心',
  care_services = '訪問介護（週2回）',
  medications = '降圧薬',
  allergies = '特になし'
where is_demo;

alter table public.care_profiles
  alter column gender set not null,
  alter column address set not null,
  alter column household set not null,
  alter column residence set not null,
  alter column emergency_contact set not null,
  alter column eating set not null,
  alter column daytime_life set not null,
  alter column care_services set not null,
  alter column medications set not null,
  alter column allergies set not null;

alter table public.care_profiles
  drop column preferred_area,
  drop column budget_min_yen,
  drop column budget_max_yen,
  drop column wants_private_room,
  drop column family_access_priority,
  drop column person_wishes,
  drop column family_wishes;
