-- DEMO case template demo_case_001 (fictional person). Cloned per anonymous user when a consultation starts.

with c as (
  insert into public.care_cases (owner_id, is_template, template_key, status, location_city_code)
  values (null, true, 'demo_case_001', 'interviewing', '27205')
  returning id
), ident as (
  insert into public.case_identities (case_id, owner_id, display_name, address_detail, phone)
  select id, null, 'デモ利用者A（架空）', '大阪府吹田市（架空の住所）', null from c
  returning case_id
), facts as (
  insert into public.case_facts (case_id, owner_id, fact_key, value, source, idempotency_key)
  select c.id, null, f.key, f.value::jsonb, 'registered_profile', 'seed:' || f.key
  from c, (values
    ('age', '82'),
    ('gender', '"女性"'),
    ('prefecture', '"大阪府"'),
    ('city', '"吹田市"'),
    ('household', '"一人暮らし"'),
    ('residence', '"自宅"'),
    ('care_level', '"要介護2"'),
    ('certification_status', '"certified"'),
    ('dementia', '"軽度あり"'),
    ('mobility', '"杖を使用"'),
    ('bathing', '"一部介助"'),
    ('toileting', '"概ね自立"'),
    ('eating', '"自立"'),
    ('medication_management', '"管理支援が必要"'),
    ('chronic_conditions', '"高血圧"'),
    ('advanced_medical_care', '"不要"'),
    ('current_services', '"訪問介護を週2回"'),
    ('family_relationship', '"長男"'),
    ('family_residence', '"大阪府内"'),
    ('family_employment', '"フルタイム"'),
    ('family_weekday_daytime', '"介護困難"'),
    ('family_visit_frequency', '"週1～2回程度"'),
    ('family_main_concern', '"母を一人にしている時間が長い"')
  ) as f (key, value)
  returning 1
)
insert into public.case_preferences (case_id, owner_id, preference_key, value, holder, source, idempotency_key)
select c.id, null, 'living_place', '"可能な限り自宅で生活を続けたい"', 'person', 'registered_profile', 'seed:living_place'
from c;
