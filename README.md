# 介護の相談AI（デモ）

家族が介護の状況をチャットで話すと、AI が状況を整理し、足りない情報だけを質問します。
そのうえで、次の3種類の候補を理由と根拠つきで提案します。

- 介護施設・介護サービス
- 相談窓口
- 介護福祉制度

提案を選ぶとやることリスト（タスク）ができ、進み具合を管理できます。

- 公開URL: https://product-test-blond.vercel.app
- **扱うデータはすべて架空のデモデータです。** 人物・事業所・統計値・制度の条件は簡略化した架空の値で、医学的・制度的な判断は行いません。

## できること

1. **相談:** 登録済みの架空の利用者（82歳・要介護2・吹田市）について、困りごとを自由に入力します。
2. **追加の質問:** 提案に必要な情報が足りないときだけ、選択式または自由記述で質問します（1回の提案までに最大2問）。
3. **提案:** 介護施設・介護サービス／相談窓口／介護福祉制度から、相談内容と集めた根拠に合うものを提案します。
   - 各カードには「なぜ候補か」「確認できたこと（デモ用の簡略ルールや制度の条件）」「参考となる利用傾向（統計）」「まだ確認したいこと」「次にやること」を表示します。
   - 統計は参考の傾向としてだけ示し、推薦の根拠にはしません。
4. **他の案を相談:** 「他の案も相談する」で聞き取りに戻り、別の観点で提案し直します。
5. **事業所候補:** 介護サービスを選ぶと、周辺の架空事業所を市区町村の代表地点からの参考距離つきで表示します。0件のときはその旨だけを表示します。
6. **タスク:** 選んだ提案に応じたタスクを作り、未着手／進行中／完了で管理します。制度や相談窓口を選んだ場合は、事業所選びを飛ばしてタスクになります。

## 構成

- **フロントエンド／API:** Next.js 16（App Router）、React 19、Tailwind CSS 4
- **AI:** Google Agent Development Kit（`@google/adk` 2.1.0）の Graph Workflow と Gemini API
- **DB:** Supabase（Postgres、PostGIS、pgvector、PGroonga）。匿名認証と RLS で、各利用者は自分の相談だけを読み書きできます。
- **ホスティング:** Vercel

### 3 Agent と Graph Workflow

LLM のエージェントは次の3つだけです。全体の流れの制御は Graph Workflow の分岐とループで行い、エージェントではありません。

| エージェント | 役割 | モデル |
|---|---|---|
| ① Care Interview | 相談内容と登録情報から事実・希望・ニーズ・意図を抽出し、次の質問を決める | `gemini-3.5-flash-lite` |
| ② Information Collection | 型付きツールで根拠を集める（制度ルール、ニーズ別の候補、統計表、事業所検索、文書検索、公式Web検索1回まで） | `gemini-3.5-flash-lite` |
| ③ Proposal | ケース情報と保存済みのツール結果だけを根拠に提案を作る | `gemini-3.5-flash` |

流れ: 聞き取り →（質問／提案へ）→ 情報収集 → 根拠の検証・補完 → 提案 → 選択待ち →（採用 → 事業所候補 → タスク作成／他の案 → 聞き取りへ戻る）

- 質問や選択の待ち状態は、ADK のセッションとして Supabase（`adk_sessions` / `adk_events`）に保存し、次のリクエストで再開します。
- ツールが返した値（事業所・距離・統計・制度の判定）は、そのまま `proposal_sources` に保存し、これを正とします。モデルの出力から値を書き戻すことはしません。
- 氏名などの識別情報は Gemini に送りません。

### 失敗時の動作

- **Agent③:** `gemini-3.5-flash` で失敗したときだけ `gemini-3.5-flash-lite` で1回やり直します（最大2リクエスト）。それも失敗したときだけ、保存済みの根拠からルールベースで提案します。
- **Agent①・②:** 失敗したときは、登録情報から推定した内容で処理を続けます。
- **DB・事業所検索・Web検索の失敗:** 失敗しても画面は止まらず、案内を表示して続行します。
- **利用上限:**
  - 1ケースあたり：Gemini 20リクエスト、提案3回、質問5問、送信15回、Web検索1回
  - 匿名ユーザー1人あたり：1日3ケース

## 実行方法

公開中のデモと同じ状態を、手元または自分の Vercel で動かす手順です。

### 必要なもの

- Node.js 24 と npm 11（動作確認に使ったのは Node.js 24.21.0 / npm 11.19.0）
- Supabase のプロジェクト（無料プランで可）
- Gemini API キー（[Google AI Studio](https://aistudio.google.com/) で発行）
  - **課金を有効にしたプロジェクトのキーを推奨します。** 無料枠では `gemini-3.5-flash` が1日20リクエストまでで、上限に達すると提案 AI は `gemini-3.5-flash-lite` に切り替わります。

### 1. Supabase を準備する

1. Supabase でプロジェクトを作成します。
2. Authentication → Sign In / Providers で **「Allow anonymous sign-ins」を有効**にします。ログインなしで使うための設定で、無効だと相談を開始できません。
3. `supabase/migrations/` の SQL を**ファイル名の順に**すべて適用します。拡張機能（PostGIS / pgvector / PGroonga）、テーブル、RLS、関数、デモデータ、文書の埋め込みまで含まれているので、別途データを投入する必要はありません。適用方法は次のどちらかです。
   - **SQL Editor:** 各ファイルの内容を古い順に貼り付けて実行します。
   - **Supabase CLI:**

     ```bash
     npx supabase init          # supabase/config.toml が無い場合のみ
     npx supabase login
     npx supabase link --project-ref <プロジェクトの ref>
     npx supabase db push
     ```

4. Project Settings → API Keys で、**Project URL** と **publishable key** を控えます。secret key / service role key は使いません。

### 2. 環境変数を設定する

```bash
cp .env.example .env.local
```

`.env.local` に値を入れます。このファイルは Git の管理対象外です。

| 変数 | 設定する値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 手順1で控えた Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 手順1で控えた publishable key |
| `GEMINI_API_KEY` | Gemini API キー（サーバー側でのみ使用） |
| `FAULT_INJECTION_ENABLED` | 通常は空のまま。障害の再現試験をするときだけ `1`（後述） |

### 3. 起動する

```bash
npm ci          # package-lock.json どおりに依存関係を入れる
npm run dev     # 開発サーバー → http://localhost:3000
```

本番と同じビルドで動かす場合は、次のとおりです。

```bash
npm run build
npm start       # http://localhost:3000
```

ブラウザで開き、「相談をはじめる」から後述の「デモの操作例」の流れで試せます。

- 匿名ユーザー1人あたり1日3ケースまでです。上限に達したら、別のブラウザやプライベートウィンドウで開くと新しい匿名ユーザーになります。

### 4. テストとチェック

```bash
npm test             # Vitest（Gemini・DB に接続せずに実行できます）
npm run lint         # ESLint
npm run build        # 本番ビルド（環境変数なしでもビルドは通ります）
npx tsc --noEmit     # 型チェック
```

- `npx tsc --noEmit` は、**`npm run build`（または `npx next typegen`）の後に**実行してください。
  - `RouteContext` などの型は、Next.js がビルド時に `.next/types` へ自動生成するためです。

### 5. Vercel にデプロイする

1. このリポジトリを Vercel にインポートします。フレームワークは Next.js が自動で選ばれ、ビルドの設定は既定のままで動きます。
2. Settings → Environment Variables に、Production と Preview の両方で次の3つを設定します。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `GEMINI_API_KEY`
3. `FAULT_INJECTION_ENABLED=1` は、障害の再現試験をしたい場合だけ **Preview にのみ**設定します。Production には設定しません。
4. デプロイします。相談のやり取り（`/api/cases/[caseId]/turn`）は途中経過を順次送る形式で、1回に最大300秒かかることがあります（`maxDuration = 300`）。

### 障害の再現（ローカル／Preview のみ）

`FAULT_INJECTION_ENABLED=1` のとき、相談画面の URL に `?fault=` を付けると、意図的に障害を起こせます。複数指定するときはカンマ区切りです。Production では常に無効です。

| 値 | 内容 |
|---|---|
| `gemini` | Gemini を失敗させる → ルールベースの提案で続行 |
| `db` | DB の取得を失敗させる → 案内を表示して続行 |
| `web` | 公式Web検索を失敗させる → DB の情報だけで続行 |
| `providers_empty` | 事業所検索を0件にする |

例: `http://localhost:3000/consult/<caseId>?fault=gemini,providers_empty`

### デモ文書の埋め込みを作り直す場合（通常は不要）

`supabase/seed-data/demo-documents.json` を変更したときだけ、次を実行して、生成された SQL を適用します。

```bash
node --env-file=.env.local scripts/generate-document-embeddings.mjs <output.sql>
```

## ディレクトリ

```
src/app/                  画面（開始・相談・タスク）と API（/api/cases, /api/cases/[caseId]/turn, /api/tasks/[taskId]）
src/lib/care-agent/       3 Agent・Graph Workflow・型付きツール・DB アクセス・画面用の組み立て
src/lib/adk/              Supabase に保存する ADK SessionService
src/lib/supabase/         Supabase クライアント（ブラウザ・サーバー）
supabase/migrations/      スキーマとデモデータ（追加のみ）
supabase/seed-data/       デモ文書
scripts/                  デモ文書の埋め込み生成
tests/                    Vitest
```

## デモの操作例

1. 「相談をはじめる」→「例文を入力欄に入れる」→ 送信
2. 質問に回答（例：入浴の頻度「週2〜3回」、サービスへの意向「前向き」）→ 提案1回目
3. 「費用や制度はどこに相談すればよいですか？」と送信 → 相談窓口・介護福祉制度を含む提案
4. 「訪問入浴介護」を選ぶ → 架空の事業所を選ぶ → タスクの状態を変更

## 既知の制限

- 事業所・統計・制度・文書はすべて架空または簡略化したデモデータです。
  - 架空事業所は9件で、訪問リハビリ・短期入所・老健・介護医療院は候補が0件になります。
- Web検索が失敗したときの動作は、ユニットテストでのみ確認しています。
- 距離は、本人の住所ではなく市区町村の代表地点からの参考値です。
