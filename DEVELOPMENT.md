# 開発・デプロイ手順

## 目次

- [前提条件](#前提条件)
- [セットアップ](#セットアップ)
- [ローカルテスト](#ローカルテスト)
- [ローカル開発サーバー](#ローカル開発サーバー)
- [デプロイ](#デプロイ)
- [型定義の再生成](#型定義の再生成)

---

## 前提条件

| ツール | 確認コマンド | 備考 |
|--------|-------------|------|
| Node.js 18以上 | `node -v` | |
| npm | `npm -v` | Node.js に同梱 |
| Wrangler CLI | `npx wrangler --version` | 初回は自動インストール |
| Cloudflareアカウント | — | デプロイ時のみ必要 |

---

## セットアップ

```bash
# リポジトリをクローン後、依存パッケージをインストール
npm install
```

---

## ローカルテスト

### テストの仕組み

- **テストランナー**: [Vitest](https://vitest.dev/) v2
- **実行環境**: [`@cloudflare/vitest-pool-workers`](https://github.com/cloudflare/workers-vitest-pool) が提供する **Miniflare**（workerd 互換ランタイム）
- **R2**: Miniflare がインメモリで R2 をエミュレートするため、実際の R2 バケットは不要
- **外部 HTTP**: `fetchMock`（`cloudflare:test` 提供）でモックするため、実際のネットワーク接続は発生しない
- **WASM**: `@cf-wasm/photon` の Rust/WASM が workerd ランタイム上で実際に動作する

### コマンド

```bash
# 全テストを1回実行（CI向け）
npm test -- --run

# ウォッチモード（ファイル保存のたびに自動再実行）
npm test
```

### テスト構成（`test/index.spec.ts`）

| describe | 主な検証内容 |
|----------|------------|
| `PUT /:uuid` | PNG/JPEG/WebP/GIF の受け付け、不正フォーマット・空ボディ・不正UUID の拒否 |
| `POST /fetch-url` | URL バリデーション、外部画像の取得・UUID返却、リサイズ、GIF パス、20MB超の拒否 |
| `GET /proxy` | キャッシュミス時の取得・保存、キャッシュヒット時の R2 から返却、リサイズ、20MB超の拒否 |
| `GET /:uuid` | 存在しない UUID の 404、PUT 後の正常取得、Content-Type の保存確認 |

### テスト設定ファイル（`vitest.config.mts`）

```toml
main: './functions/[[route]].ts'   # Workers エントリポイント
compatibilityDate: '2024-10-11'
compatibilityFlags: ['nodejs_compat']
r2Buckets: ['MY_BUCKET']           # インメモリ R2 バケット名
```

### よくあるエラー

| エラー | 原因 | 対処 |
|--------|------|------|
| `RuntimeError: unreachable` in photon | photon に無効な画像バイト列を渡した | テスト用画像は `makePng()` で生成した有効な PNG を使う |
| `fetch is not allowed` | `fetchMock.disableNetConnect()` が有効な状態でモック未登録のURLを叩いた | `fetchMock.get(...).intercept(...).reply(...)` を先に登録する |
| `TypeError: Cannot read properties of undefined` | `waitOnExecutionContext(ctx)` を忘れた | テストの最後に必ず `await waitOnExecutionContext(ctx)` を呼ぶ |

---

## ローカル開発サーバー

Wrangler の Pages Dev サーバーを使う。`functions/` ディレクトリを自動認識してルーティングする。

### 起動

```bash
npm run dev
# または
npm start
```

デフォルトで `http://localhost:8788` で起動する。

### ローカル R2 の扱い

`wrangler pages dev` はデフォルトでは R2 をエミュレートしないため、
ローカルで R2 の永続化が必要な場合は `--persist-to` オプションを付ける。

```bash
npx wrangler pages dev public --persist-to .wrangler/state
```

`.wrangler/state/` にローカルの R2 データが保存される。
`.gitignore` に追加しておくこと。

### 動作確認例

```bash
# 画像 URL を登録して UUID を取得
curl -X POST http://localhost:8788/fetch-url \
  -H "Content-Type: text/plain" \
  --data "https://example.com/image.png"
# → xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# UUID で画像を取得
curl http://localhost:8788/<uuid> --output out.png

# プロキシ経由で取得（2048px 以内にリサイズされて返る）
curl "http://localhost:8788/proxy?url=https://example.com/large.png" --output out.png
```

---

## デプロイ

### 初回：Cloudflare にログイン

```bash
npx wrangler login
```

ブラウザが開くので Cloudflare アカウントで認証する。

### 初回：R2 バケットを作成

`wrangler.toml` で `bucket_name = "image2vrc"` と指定しているため、
同名のバケットが Cloudflare アカウントに存在している必要がある。

```bash
# バケットが未作成の場合
npx wrangler r2 bucket create image2vrc
```

作成済みかどうかは Cloudflare ダッシュボードの R2 セクション、
またはコマンドで確認できる。

```bash
npx wrangler r2 bucket list
```

### デプロイ実行

```bash
npm run deploy
# 実体: wrangler pages deploy
```

`public/` ディレクトリの静的ファイルと `functions/` のルートハンドラーが
Cloudflare Pages にアップロードされる。

デプロイ成功時にデプロイ URL が表示される。

```
✨ Deployment complete! Take a peek over at https://image2vrc.pages.dev
```

### 初回：R2 バケットを Pages プロジェクトにバインド

ダッシュボードから設定する場合:

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **Workers & Pages** → `image2vrc`
2. **Settings** → **Bindings** → **Add** → **R2 Bucket**
3. Variable name: `MY_BUCKET` / R2 bucket: `image2vrc` を選択して保存
4. 再デプロイ（バインドを反映させるため）

```bash
npm run deploy
```

### CI/CD（Cloudflare Pages の GitHub 連携による自動デプロイ）

Cloudflare ダッシュボードだけで設定する。設定後は `main` への push だけで自動デプロイされる。

```
push to main → Cloudflare Pages（GitHub 連携）→ 自動デプロイ
```

#### 初回設定手順

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) を開く
2. **Workers & Pages** → **Create** → **Pages** タブ → **Connect to Git**
3. GitHub アカウントを連携し、`image2vrc` リポジトリを選択して **Begin setup**
4. ビルド設定を以下のように入力する

   | 項目 | 値 |
   |------|----|
   | Framework preset | `None` |
   | Build command | （空欄） |
   | Build output directory | `public` |

5. **Save and Deploy** → 初回デプロイが走る

#### R2 バケットのバインドを追加

デプロイ完了後、R2 バインドを設定しないと画像の保存が動かない。

1. **Workers & Pages** → `image2vrc` → **Settings** → **Bindings**
2. **Add** → **R2 Bucket**
3. 以下を入力して保存

   | 項目 | 値 |
   |------|----|
   | Variable name | `MY_BUCKET` |
   | R2 bucket | `image2vrc` |

4. **Save** 後、**Deployments** タブから最新デプロイの **Retry deployment** を押して反映させる

#### 以降の自動デプロイ

`main` ブランチに push するたびに Cloudflare が自動でビルド・デプロイする。
デプロイ状況は **Workers & Pages** → `image2vrc` → **Deployments** タブで確認できる。

---

## 型定義の再生成

`wrangler.toml` のバインディングを変更した場合、`worker-configuration.d.ts` を更新する。

```bash
npm run cf-typegen
# 実体: wrangler types
```
