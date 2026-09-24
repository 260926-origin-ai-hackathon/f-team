-- DEMO providers, documents and task templates. All providers are FICTIONAL (DEMO- codes, fictional addresses/coords).

-- Municipal representative points (approximate city-hall area; public reference, not personal data).
insert into public.city_reference_points (city_code, prefecture, city, label, location) values
  ('27205', '大阪府', '吹田市', '吹田市の代表地点（市役所付近）', extensions.st_setsrid(extensions.st_makepoint(135.5168, 34.7597), 4326)::extensions.geography),
  ('27203', '大阪府', '豊中市', '豊中市の代表地点（市役所付近）', extensions.st_setsrid(extensions.st_makepoint(135.4696, 34.7813), 4326)::extensions.geography);

insert into public.providers (provider_code, provider_name, service_code, service_name, prefecture, city, city_code, address, location, capacity, summary) values
  ('DEMO-110-001', '架空・みどり訪問介護センター', '110', '訪問介護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）1-1',
   extensions.st_setsrid(extensions.st_makepoint(135.5230, 34.7630), 4326)::extensions.geography, null,
   '身体介護（入浴・排泄介助）と生活援助に対応するデモ事業所。早朝・夕方の訪問も相談可（デモ設定）。'),
  ('DEMO-120-001', '架空・ゆずり訪問入浴サービス', '120', '訪問入浴介護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）2-3',
   extensions.st_setsrid(extensions.st_makepoint(135.5105, 34.7702), 4326)::extensions.geography, null,
   '浴槽を持ち込み、看護職員1名・介護職員2名で入浴を介助するデモ事業所（デモ設定）。'),
  ('DEMO-130-001', '架空・北摂訪問看護ステーション', '130', '訪問看護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）3-5',
   extensions.st_setsrid(extensions.st_makepoint(135.5301, 34.7555), 4326)::extensions.geography, null,
   '服薬管理や体調確認、医療的な相談に対応するデモ事業所（デモ設定）。'),
  ('DEMO-150-001', '架空・あおばデイサービス', '150', '通所介護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）4-2',
   extensions.st_setsrid(extensions.st_makepoint(135.5042, 34.7520), 4326)::extensions.geography, 30,
   '送迎・入浴・昼食・機能訓練のある日中通所のデモ事業所。定員30名（デモ設定）。'),
  ('DEMO-160-001', '架空・ひかり通所リハセンター', '160', '通所リハビリテーション', '大阪府', '豊中市', '27203', '大阪府豊中市（架空住所）1-8',
   extensions.st_setsrid(extensions.st_makepoint(135.4760, 34.7790), 4326)::extensions.geography, 25,
   '理学療法士によるリハビリ中心の通所デモ事業所。定員25名（デモ設定）。'),
  ('DEMO-730-001', '架空・つながり小規模多機能ホーム', '730', '小規模多機能型居宅介護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）5-6',
   extensions.st_setsrid(extensions.st_makepoint(135.5195, 34.7680), 4326)::extensions.geography, 29,
   '通い・訪問・泊まりを同じスタッフが組み合わせて支えるデモ事業所。登録定員29名（デモ設定）。'),
  ('DEMO-760-001', '架空・ほくせつ定期巡回センター', '760', '定期巡回・随時対応型訪問介護看護', '大阪府', '豊中市', '27203', '大阪府豊中市（架空住所）2-4',
   extensions.st_setsrid(extensions.st_makepoint(135.4820, 34.7750), 4326)::extensions.geography, null,
   '日中・夜間の定期巡回と随時対応を行うデモ事業所（デモ設定）。'),
  ('DEMO-510-001', '架空・さくら特別養護老人ホーム', '510', '介護老人福祉施設', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）6-1',
   extensions.st_setsrid(extensions.st_makepoint(135.5360, 34.7710), 4326)::extensions.geography, 80,
   '常時介護が必要な方の生活施設のデモ。定員80名（デモ設定）。'),
  ('DEMO-320-001', '架空・こもれびグループホーム', '320', '認知症対応型共同生活介護', '大阪府', '吹田市', '27205', '大阪府吹田市（架空住所）7-9',
   extensions.st_setsrid(extensions.st_makepoint(135.5010, 34.7650), 4326)::extensions.geography, 18,
   '認知症の方が少人数で共同生活を送るデモ事業所。2ユニット18名（デモ設定）。');

insert into public.provider_services (provider_id, care_service_code)
select p.provider_id, m.care_service_code
from (values
  ('DEMO-110-001', 'S001'), ('DEMO-120-001', 'S002'), ('DEMO-130-001', 'S003'), ('DEMO-150-001', 'S005'),
  ('DEMO-160-001', 'S006'), ('DEMO-730-001', 'S008'), ('DEMO-760-001', 'S009'), ('DEMO-510-001', 'S011'),
  ('DEMO-320-001', 'S010')
) as m (provider_code, care_service_code)
join public.providers p on p.provider_code = m.provider_code;

insert into public.knowledge_documents (title, document_type, body) values
  ('訪問介護とは', 'service_guide',
   '訪問介護は、訪問介護員（ホームヘルパー）が自宅を訪問し、入浴・排泄・食事などの身体介護や、掃除・洗濯・調理などの生活援助を行うサービスです。自宅の浴室での入浴介助を受けられる場合があります。利用にはケアプランへの位置づけが必要です。（デモ文書）'),
  ('訪問入浴介護とは', 'service_guide',
   '訪問入浴介護は、浴槽を積んだ車などで自宅を訪問し、看護職員と介護職員が入浴を介助するサービスです。自宅の浴室が使いにくい場合や、一人での入浴が難しい場合に検討されます。体調によっては清拭等に変更されることがあります。（デモ文書）'),
  ('定期巡回・随時対応型訪問介護看護とは', 'service_guide',
   '定期巡回・随時対応型訪問介護看護は、日中・夜間を通じて定期的に巡回訪問し、必要に応じて随時の対応も行う地域密着型サービスです。一人暮らしで見守りが必要な方の在宅生活を支える選択肢の一つです。（デモ文書）'),
  ('小規模多機能型居宅介護とは', 'service_guide',
   '小規模多機能型居宅介護は、通い・訪問・泊まりを一つの事業所で組み合わせて利用できる地域密着型サービスです。なじみのスタッフが継続して関わるため、認知症の方や生活リズムに変化がある方にも使われます。原則として事業所と同じ市町村に住む方が対象です。（デモ文書）'),
  ('架空自治体「みどり市」の要介護認定の手続き', 'procedure',
   '架空のみどり市では、要介護認定の申請は市の介護保険担当窓口または地域包括支援センターで受け付けます。申請後に認定調査と主治医意見書の手続きがあり、結果が通知されます。実際の手続きは自治体によって異なるため、お住まいの自治体の公式情報を確認してください。（デモ文書）'),
  ('架空・つながり小規模多機能ホームのご案内', 'facility_intro',
   '架空・つながり小規模多機能ホームは、通い・訪問・泊まりを同じスタッフが組み合わせて支えるデモ事業所です。日中の通いでは入浴支援や昼食があり、ご家族が仕事で不在の時間帯の見守りにも対応します（すべてデモ設定です）。');

-- One chunk per short demo document; embeddings are added by a separate seed.
insert into public.document_chunks (document_id, chunk_index, content)
select id, 0, body from public.knowledge_documents;

insert into public.task_templates (id, target_type, target_code, title, steps, caveat) values
  ('T-A001', 'action', 'A001', '要介護認定を申請する', '[
    {"step_id": "1", "title": "自治体の申請窓口を確認する", "detail": "自治体公式情報で窓口と必要書類を確認する。", "requires_official_check": true},
    {"step_id": "2", "title": "申請する", "detail": "窓口または地域包括支援センター等で申請する。", "requires_official_check": true},
    {"step_id": "3", "title": "認定調査を受ける", "detail": "調査員の訪問日程を調整する。", "requires_official_check": false},
    {"step_id": "4", "title": "主治医意見書等の手続きを確認する", "detail": "主治医に意見書の依頼があることを伝える。", "requires_official_check": true},
    {"step_id": "5", "title": "認定結果を確認する", "detail": "通知された要介護度を確認する。", "requires_official_check": false},
    {"step_id": "6", "title": "必要に応じてケアプランを相談する", "detail": "ケアマネジャー等にサービス利用を相談する。", "requires_official_check": false}
  ]', '自治体によって手続きの詳細が異なります。自治体公式情報を確認してください。'),
  ('T-A002', 'action', 'A002', '地域包括支援センターに相談する', '[
    {"step_id": "1", "title": "担当の地域包括支援センターを調べる", "detail": "住所地を担当するセンターを自治体公式情報で確認する。", "requires_official_check": true},
    {"step_id": "2", "title": "相談したいことを整理する", "detail": "困りごと・本人の希望・家族の状況をメモする。", "requires_official_check": false},
    {"step_id": "3", "title": "電話または来所で相談する", "detail": "相談日時を予約する。", "requires_official_check": false},
    {"step_id": "4", "title": "提案された次の手続きを確認する", "detail": "認定申請やサービス利用の流れを確認する。", "requires_official_check": false}
  ]', '相談窓口の名称や受付方法は自治体によって異なります。'),
  ('T-S001', 'service', 'S001', '訪問介護の利用を検討する', '[
    {"step_id": "1", "title": "家族で利用希望を確認する", "detail": "本人の希望と、頼みたい支援内容を話し合う。", "requires_official_check": false},
    {"step_id": "2", "title": "周辺事業所を比較する", "detail": "候補事業所の対応内容・時間帯を比べる。", "requires_official_check": false},
    {"step_id": "3", "title": "事業所へ問い合わせる", "detail": "空き状況・対応可能な時間帯を確認する。", "requires_official_check": false},
    {"step_id": "4", "title": "ケアマネジャーに相談する", "detail": "ケアプランへの位置づけを相談する。", "requires_official_check": false},
    {"step_id": "5", "title": "利用開始日を決める", "detail": "契約内容を確認して開始日を決める。", "requires_official_check": false}
  ]', '利用条件・料金は事業所と担当ケアマネジャーに確認してください。'),
  ('T-S002', 'service', 'S002', '訪問入浴を検討する', '[
    {"step_id": "1", "title": "家族で利用希望を確認する", "detail": "本人の抵抗感や希望する頻度を話し合う。", "requires_official_check": false},
    {"step_id": "2", "title": "周辺事業所を比較する", "detail": "候補事業所の対応日・体制を比べる。", "requires_official_check": false},
    {"step_id": "3", "title": "事業所へ問い合わせる", "detail": "利用可能な曜日・時間帯を確認する。", "requires_official_check": false},
    {"step_id": "4", "title": "利用条件・料金を確認する", "detail": "自己負担額や体調による変更の扱いを確認する。", "requires_official_check": false},
    {"step_id": "5", "title": "ケアマネ等へ相談する", "detail": "ケアプランへの位置づけを相談する。", "requires_official_check": false},
    {"step_id": "6", "title": "利用開始日を決める", "detail": "開始日と初回の段取りを決める。", "requires_official_check": false}
  ]', '利用条件・料金は事業所と担当ケアマネジャーに確認してください。'),
  ('T-S011', 'service', 'S011', '施設見学を予約する', '[
    {"step_id": "1", "title": "入所条件を確認する", "detail": "要介護度等の入所条件と申込方法を確認する。", "requires_official_check": true},
    {"step_id": "2", "title": "見学を予約する", "detail": "施設へ連絡し見学日を決める。", "requires_official_check": false},
    {"step_id": "3", "title": "見学で確認することを整理する", "detail": "費用・医療体制・面会・居室を確認する。", "requires_official_check": false},
    {"step_id": "4", "title": "家族で検討する", "detail": "本人の希望と見学結果を話し合う。", "requires_official_check": false}
  ]', '入所条件・待機状況は施設と自治体に確認してください。'),
  ('T-GENERIC', 'service', '*', 'サービスの利用を検討する', '[
    {"step_id": "1", "title": "家族で利用希望を確認する", "detail": "本人の希望と、頼みたい支援内容を話し合う。", "requires_official_check": false},
    {"step_id": "2", "title": "周辺事業所を比較する", "detail": "候補事業所の対応内容を比べる。", "requires_official_check": false},
    {"step_id": "3", "title": "事業所へ問い合わせる", "detail": "空き状況・利用条件を確認する。", "requires_official_check": false},
    {"step_id": "4", "title": "ケアマネジャー等へ相談する", "detail": "ケアプランへの位置づけを相談する。", "requires_official_check": false}
  ]', '利用条件・料金は事業所と担当ケアマネジャーに確認してください。');
