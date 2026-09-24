-- DEMO statistics: table structures modelled on public datasets; ALL VALUES ARE FICTIONAL (is_demo = true).
-- Observations are aggregate cells, never person records.

insert into public.stat_datasets (dataset_code, dataset_name, survey_year, source_note) values
  ('K25', '2025年国民生活基礎調査（介護票）', 2025, 'e-Stat上の集計表（CSV）の構造を模倣したデモ。数値は架空値。'),
  ('C26', '介護給付費等実態統計（2026年5月審査分）', 2026, '集計表の構造を模倣したデモ。数値は架空値。個々の明細ではない。'),
  ('S22', '2022年介護サービス施設・事業所調査', 2022, '施設種類別の在所者数等の集計構造を模倣したデモ。数値は架空値。'),
  ('S24', '2024年介護サービス施設・事業所調査', 2024, 'S22とは別の観測。供給状況等の集計構造を模倣したデモ。数値は架空値。');

insert into public.stat_tables (dataset_id, table_code, table_number, title, dimension_keys, population_definition, measure_definition, multiple_response, source_note)
select d.id, t.table_code, t.table_number, t.title, t.dimension_keys, t.population_definition, t.measure_definition, t.multiple_response, 'デモ（架空値）'
from (values
  ('K25', 'K25-42', 42, '要介護度×利用した介護サービス', array['care_level', 'service_category'],
   '介護保険の要介護・要支援認定を受けた在宅の者（デモ）', '介護を要する者数（デモ値）', true),
  ('K25', 'K25-45', 45, '主な介護者の介護時間×利用した介護サービス', array['caregiving_time', 'service_category'],
   '介護を要する者（デモ）', '介護を要する者数（デモ値）', true),
  ('K25', 'K25-47', 47, '要介護度×介護保険サービスを利用しない理由', array['care_level', 'non_use_reason'],
   '介護保険サービスを利用していない者（デモ）', '介護を要する者数（デモ値）', true),
  ('K25', 'K25-69', 69, '主な介護者の仕事の有無×介護時間×続柄×利用した介護サービス',
   array['caregiver_work', 'caregiving_time', 'relationship', 'service_category'],
   '同居の主な介護者がいる介護を要する者（デモ）', '介護を要する者数（デモ値）', true),
  ('K25', 'K25-87', 87, '要介護度×主な介護内容×介護者の組合せ', array['care_level', 'main_care_content', 'caregiver_combination'],
   '介護を要する者（デモ）', '介護を要する者数（デモ値）', true),
  ('C26', 'C26-2', 2, '要介護度×介護サービス種類（受給者数・費用額）', array['care_level', 'service_type'],
   '介護給付費明細の集計（デモ）', '受給者数（デモ値）', false),
  ('C26', 'C26-9', 9, '要介護度×サービス種類内容（単位数・回数・日数・件数）', array['care_level', 'service_content'],
   '介護給付費明細の集計（デモ）', '回数等（デモ値）', false),
  ('C26', 'C26-10', 10, '訪問介護×要介護度×内容類型×所要時間', array['care_level', 'content_type', 'duration'],
   '訪問介護の給付費明細の集計（デモ）', '件数（デモ値）', false),
  ('S22', 'S22-34', 34, '施設種類×性×年齢階級×要介護度', array['facility_type', 'sex', 'age_group', 'care_level'],
   '介護保険施設の在所者（デモ）', '在所者数（デモ値）', false),
  ('S22', 'S22-36', 36, '施設種類×要介護度×認知症高齢者の日常生活自立度', array['facility_type', 'care_level', 'dementia_independence'],
   '介護保険施設の在所者（デモ）', '在所者数（デモ値）', false),
  ('S22', 'S22-37', 37, '施設種類×要介護度×障害高齢者の日常生活自立度（寝たきり度）', array['facility_type', 'care_level', 'bedridden_level'],
   '介護保険施設の在所者（デモ）', '在所者数（デモ値）', false),
  -- No official table number: this demo record must not pose as a real table.
  ('S24', 'S24-DEMO', null, '2024年施設・事業所供給状況デモ', array['facility_type', 'region'],
   '施設・事業所（デモ）', '施設・事業所数（デモ値）', false)
) as t (dataset_code, table_code, table_number, title, dimension_keys, population_definition, measure_definition, multiple_response)
join public.stat_datasets d on d.dataset_code = t.dataset_code;

insert into public.stat_observations (table_id, dimensions, measure, value, unit, annotation)
select t.id, o.dimensions::jsonb, o.measure, o.value, 'デモ値', '架空値。統計的意味を持たない。'
from (values
  ('K25-42', '{"care_level": "要介護2", "service_category": "訪問系"}', 'demo_count', 1200),
  ('K25-42', '{"care_level": "要介護2", "service_category": "通所系"}', 'demo_count', 1500),
  ('K25-42', '{"care_level": "要介護2", "service_category": "短期入所系"}', 'demo_count', 300),
  ('K25-42', '{"care_level": "要介護2", "service_category": "小規模多機能型等"}', 'demo_count', 180),
  ('K25-47', '{"care_level": "要介護2", "non_use_reason": "本人が利用を望まない"}', 'demo_count', 310),
  ('K25-47', '{"care_level": "要介護2", "non_use_reason": "家族で介護できる"}', 'demo_count', 260),
  ('K25-47', '{"care_level": "要介護2", "non_use_reason": "利用方法が分からない"}', 'demo_count', 140),
  ('K25-47', '{"care_level": "要介護2", "non_use_reason": "費用面"}', 'demo_count', 90),
  ('K25-69', '{"caregiver_work": "仕事あり", "caregiving_time": "必要なときに手助け", "relationship": "子", "service_category": "通所系"}', 'demo_count', 430),
  ('K25-69', '{"caregiver_work": "仕事あり", "caregiving_time": "必要なときに手助け", "relationship": "子", "service_category": "訪問系"}', 'demo_count', 360),
  ('K25-69', '{"caregiver_work": "仕事あり", "caregiving_time": "必要なときに手助け", "relationship": "子", "service_category": "短期入所系"}', 'demo_count', 95),
  ('K25-87', '{"care_level": "要介護2", "main_care_content": "入浴", "caregiver_combination": "家族＋訪問介護事業者"}', 'demo_count', 250),
  ('C26-2', '{"care_level": "要介護2", "service_type": "訪問介護"}', 'demo_recipients', 1400),
  ('C26-2', '{"care_level": "要介護2", "service_type": "訪問看護"}', 'demo_recipients', 520),
  ('C26-2', '{"care_level": "要介護2", "service_type": "通所介護"}', 'demo_recipients', 1700),
  ('C26-2', '{"care_level": "要介護2", "service_type": "小規模多機能"}', 'demo_recipients', 210),
  ('S22-37', '{"facility_type": "介護老人福祉施設", "care_level": "要介護3", "bedridden_level": "B"}', 'demo_residents', 800),
  ('S22-37', '{"facility_type": "介護老人保健施設", "care_level": "要介護3", "bedridden_level": "B"}', 'demo_residents', 600),
  ('S22-37', '{"facility_type": "介護医療院", "care_level": "要介護3", "bedridden_level": "B"}', 'demo_residents', 350)
) as o (table_code, dimensions, measure, value)
join public.stat_tables t on t.table_code = o.table_code;
