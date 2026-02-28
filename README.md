# image2vrc

VRChat の UnityWebRequestTexture 向けに画像をアップロード・配信する Web アプリ。

## 機能

- **画像アップロード**: ファイル選択またはクリップボードからペーストで PNG / JPEG / WebP / GIF をアップロード
- **URL から取得**: 外部画像 URL を指定してサーバーサイドで取得・再ホスト
- **プロキシ API**: `GET /proxy?url=<encoded>` で外部画像を R2 キャッシュ付きでプロキシ配信
- **自動リサイズ**: 2048px を超える画像はブラウザ側で自動リサイズ（ファイルアップロード時）
- **URL 生成**: アップロード後、VRChat で使用可能な URL を自動コピー
- **画像配信**: `GET /:uuid` で画像を直接配信（CDN キャッシュ付き）

## アーキテクチャ

Cloudflare Pages + Pages Functions + R2 を使用。

```
public/index.html     ← Pages CDN で静的配信（無料）
functions/[[route]].ts
  POST /fetch-url     ← 外部 URL から画像取得・R2 保存（UUID を返す）
  GET  /proxy         ← 外部 URL をプロキシ配信（R2 キャッシュ付き）
  PUT  /:uuid         ← 画像アップロード（Pages Function）
  GET  /:uuid         ← 画像配信（Pages Function + Cache）
Cloudflare R2         ← 画像ストレージ（非公開）
```

### プロキシ API の使い方

VRChat のテクスチャ URL として外部画像を直接指定できます。

```
https://image2vrc.smisann.net/proxy?url=任意の画像のアドレス
```

- R2 にキャッシュがあればそのまま返す（fetch なし）
- キャッシュなしの場合は外部 URL を取得して R2 に保存してから返す
- キャッシュキーは URL の SHA-256 ハッシュ（`p-` プレフィックス付き）

### セキュリティ

- マジックバイト検証: Content-Type ヘッダーを信用せず、実際のバイナリで画像フォーマットを判定
- サイズ制限: 5MB 以下のみ受け付け
- UUID 長バリデーション: 36 文字の UUID のみ受け付け
- スキーム制限: `https:` のみ受け付け（`POST /fetch-url`・`GET /proxy`）
- 対応フォーマット: PNG / JPEG / WebP / GIF のみ

## デプロイ手順

### 1. R2 バケット作成

```bash
wrangler r2 bucket create image2vrc
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. ローカル開発

```bash
npm run dev
# → http://localhost:8788 で動作確認
```

### 4. デプロイ

```bash
npm run deploy
```

### 5. カスタムドメイン設定

Cloudflare Pages の設定画面からカスタムドメインを設定してください。

## テスト

```bash
npm test
```
