-- Proposals cover three categories: care services/facilities, consultation windows (care_actions)
-- and care/welfare programs (care_programs, new). Additive: new tables and rows; the target_type
-- checks are only widened.

create table public.care_programs (
  code text primary key,
  name text not null,
  program_type text not null check (program_type in ('cost_reduction', 'equipment_housing', 'family_support')),
  description text not null,
  conditions_note text not null, -- simplified demo conditions, never a final eligibility decision
  where_to_apply text not null,
  caveat text not null,
  is_demo boolean not null default true
);

-- Life needs -> candidate programs (same role as need_service_mappings for services/actions).
create table public.need_program_mappings (
  id uuid primary key default gen_random_uuid(),
  need_code text not null,
  need_label text not null,
  program_code text not null references public.care_programs (code),
  strength text not null check (strength in ('primary', 'secondary')),
  rationale text not null,
  is_demo boolean not null default true,
  constraint need_program_mappings_key unique (need_code, program_code)
);

alter table public.care_programs enable row level security;
alter table public.need_program_mappings enable row level security;
revoke all on public.care_programs, public.need_program_mappings from anon;
grant select on public.care_programs, public.need_program_mappings to authenticated;
create policy "Reference data is readable" on public.care_programs for select to authenticated using (true);
create policy "Reference data is readable" on public.need_program_mappings for select to authenticated using (true);

alter table public.proposals drop constraint proposals_target_type_check;
alter table public.proposals add constraint proposals_target_type_check check (target_type in ('service', 'action', 'program'));
alter table public.task_templates drop constraint task_templates_target_type_check;
alter table public.task_templates add constraint task_templates_target_type_check check (target_type in ('service', 'action', 'program'));

-- Demo program master (simplified; users must confirm with official municipal information).
insert into public.care_programs (code, name, program_type, description, conditions_note, where_to_apply, caveat) values
  ('P001', '高額介護サービス費', 'cost_reduction',
   '1か月の介護保険サービスの自己負担額が上限を超えた場合、超えた分が払い戻される制度。',
   '介護保険サービスを利用し、自己負担額が所得区分ごとの上限を超えた場合（デモ用簡略）。',
   '市区町村の介護保険担当窓口', '上限額・申請方法は自治体公式情報で確認してください。'),
  ('P002', '介護保険負担限度額認定', 'cost_reduction',
   'ショートステイや施設を利用するときの食費・居住費の負担を軽くする制度。',
   '所得や預貯金が一定以下の場合（デモ用簡略）。',
   '市区町村の介護保険担当窓口', '対象要件・必要書類は自治体公式情報で確認してください。'),
  ('P003', '特定福祉用具購入費の支給', 'equipment_housing',
   'シャワーチェアなど入浴補助用具の購入費の一部が支給される制度。',
   '要支援・要介護の認定を受け、指定を受けた事業者から購入する場合（デモ用簡略）。',
   '市区町村の介護保険担当窓口（ケアマネジャー経由が一般的）', '支給上限・対象用具は自治体公式情報で確認してください。'),
  ('P004', '住宅改修費の支給', 'equipment_housing',
   '手すりの取付けや段差の解消など、住宅改修の費用の一部が支給される制度。',
   '要支援・要介護の認定を受け、工事の前に申請する場合（デモ用簡略）。',
   '市区町村の介護保険担当窓口（ケアマネジャー経由が一般的）', '事前申請が必要です。上限額は自治体公式情報で確認してください。'),
  ('P005', '介護休業・介護休暇', 'family_support',
   '家族を介護する働く人が、休業や短時間の休暇を取得できる制度（育児・介護休業法）。',
   '要介護状態の家族を介護する労働者（勤務先の規定と法の要件による。デモ用簡略）。',
   '勤務先の人事・総務担当（介護休業給付金はハローワーク）', '取得条件・給付は勤務先と公式情報で確認してください。');

insert into public.need_program_mappings (need_code, need_label, program_code, strength, rationale) values
  ('cost_burden', '費用負担が心配', 'P001', 'primary', '介護サービスの自己負担が大きい場合の払い戻し制度。'),
  ('cost_burden', '費用負担が心配', 'P002', 'secondary', 'ショートステイ・施設利用時の食費・居住費の軽減。'),
  ('bathing_support', '入浴の支援', 'P003', 'secondary', 'シャワーチェア等の入浴補助用具の購入費支給。'),
  ('bathing_support', '入浴の支援', 'P004', 'secondary', '浴室の手すり取付け等の住宅改修費支給。'),
  ('family_work_balance', '仕事と介護の両立', 'P005', 'primary', '働く家族が介護のために休業・休暇を取得できる。'),
  ('family_respite', '家族の負担軽減', 'P005', 'secondary', '働く家族の介護時間を確保する制度。');

-- Consultation windows as candidates for consultation / cost / work-balance needs.
insert into public.need_service_mappings (need_code, need_label, action_code, strength, rationale) values
  ('consultation_entry', 'どこに相談すればよいか知りたい', 'A003', 'primary', '認定済みで担当ケアマネジャーがいる場合の最初の相談先。'),
  ('cost_burden', '費用負担が心配', 'A003', 'primary', 'ケアプランの見直しや費用を抑える組み合わせを相談できる。'),
  ('cost_burden', '費用負担が心配', 'A002', 'secondary', '費用や利用できる制度を総合的に相談できる。'),
  ('family_work_balance', '仕事と介護の両立', 'A002', 'secondary', '仕事と介護の両立について地域の支援を相談できる。');

insert into public.task_templates (id, target_type, target_code, title, steps, caveat) values
  ('T-A003', 'action', 'A003', 'ケアマネジャーに相談する', '[
    {"step_id": "1", "title": "相談したいことを整理する", "detail": "困りごと・希望・費用の心配をメモにまとめる。", "requires_official_check": false},
    {"step_id": "2", "title": "ケアマネジャーに連絡する", "detail": "面談や電話の日程を決める。", "requires_official_check": false},
    {"step_id": "3", "title": "ケアプランの見直しを相談する", "detail": "サービスの組み合わせや費用について相談する。", "requires_official_check": false}
  ]', '担当ケアマネジャーが分からない場合は地域包括支援センターに相談してください。'),
  ('T-PROGRAM', 'program', '*', '制度の利用を検討する', '[
    {"step_id": "1", "title": "制度の対象かを確認する", "detail": "自治体公式情報で要件を確認する。", "requires_official_check": true},
    {"step_id": "2", "title": "窓口に問い合わせる", "detail": "申請窓口・必要書類を確認する。", "requires_official_check": true},
    {"step_id": "3", "title": "ケアマネジャー等に相談する", "detail": "申請の進め方を相談する。", "requires_official_check": false},
    {"step_id": "4", "title": "申請する", "detail": "必要書類をそろえて申請する。", "requires_official_check": true}
  ]', '制度の要件・金額は自治体・勤務先などの公式情報で確認してください。');
