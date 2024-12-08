/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	MY_BUCKET: R2Bucket;
}

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image to VRC</title>
  <style>
    /* 背景の設定 */
    body {
      font-family: Arial, sans-serif;
      background-color: #f0f2f5;
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      position: relative;
    }

    /* 島のように浮かび上がらせるコンテナ */
    .container {
      background-color: #fff;
      padding: 30px 20px;
      border-radius: 12px;
      box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.2);
      width: 100%;
      max-width: 600px;
      text-align: center;
    }

    /* ヘッダーと説明 */
    h1, p {
      margin: 0 0 15px;
    }

    /* ピンク色のファイル選択ボタン */
    input[type="file"] {
      display: none;
    }

    .label-button {
      display: inline-block;
      padding: 10px 20px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      background-color: #ff7bff;
      color: #fff;
      margin-bottom: 15px;
      transition: background-color 0.3s;
    }

    .label-button:hover {
      background-color: #b356b3;
    }

    /* アップロードボタン */
    button {
      padding: 10px 20px;
      font-size: 16px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      background-color: #ff7bff;
      color: #fff;
      margin-top: 10px;
      transition: background-color 0.3s;
    }

    button:hover {
      background-color: #b356b3;
    }

    /* アップロード状態の表示エリア */
    #statusMessage {
      font-weight: bold;
      margin-top: 15px;
      font-size: 18px;
    }

    #statusMessage.success {
      color: green;
    }

    #statusMessage.fail {
      color: red;
    }

    /* 画像プレビュー */
    #preview {
      max-width: 100%;
      margin-top: 15px;
      border-radius: 5px;
      display: block;
      margin-left: auto;
      margin-right: auto;
    }

    /* 最近生成したURLのコンテナ */
    #recentUrlContainer {
      margin-top: 20px;
      text-align: center;
      width: 100%;
    }

    #recentUrlContainer p {
      font-weight: bold;
    }

    #recentUrl {
      font-size: 16px;
      color: #007bff;
      word-break: break-all;
    }

    #copyButton {
      padding: 8px 16px;
      font-size: 14px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      background-color: #28a745;
      color: #fff;
      margin-top: 10px;
    }

    #copyButton:hover {
      background-color: #218838;
    }

    /* 使い方リンク */
    .help-link {
      position: absolute;
      bottom: 20px;
      right: 20px;
      font-size: 14px;
      font-weight: bold;
      text-decoration: none;
      color: #007bff;
      transition: color 0.3s;
    }

    .help-link:hover {
      color: #0056b3;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Image to VRC</h1>
    <p>VRCのUnityWebRequestTexture向けに画像をアップロードできる</p>

    <!-- ピンク色のファイル選択ボタン -->
    <label class="label-button" for="fileInput">ファイルを選択</label>
    <input type="file" id="fileInput" accept="image/png, image/jpeg">
    
    <!-- アップロードボタン -->
    <button id="uploadButton" onclick="uploadImage()">画像をアップロード</button>

    <p>又はクリップボードから貼り付け</p>

    <!-- 最近生成したURLとコピー機能 -->
    <div id="recentUrlContainer">
      <p>最近生成したURL:</p>
      <div id="recentUrl"></div>
      <button id="copyButton" onclick="copyToClipboard()" style="display: none;">クリップボードにコピー</button>
    </div>

    <!-- アップロード状態の表示エリア -->
    <p id="statusMessage"></p>
    <!-- 画像のプレビュー表示用 -->
    <img id="preview" style="display: none;">
  </div>

  <!-- 使い方リンク -->
  <a href="https://smisann.fanbox.cc/posts/8882303" class="help-link" target="_blank">使い方はこちら</a>
</body>
</html>
`;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const key = url.pathname.slice(1);
		const keylength = 36;

		switch (request.method) {
			case 'PUT':
				// Content-Lengthヘッダーを取得
				const contentLength = request.headers.get('Content-Length');

				// Content-Lengthが5MB（5 * 1024 * 1024バイト）以下であるか確認
				if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
					return new Response('ファイルが大きすぎます。最大サイズは5MBです。', { status: 413 }); // 413 Payload Too Large
				}
				if (key.length != keylength) {
					return new Response('不正なファイルです', { status: 400 }); //400 Bad Request
				}

				// ファイルが条件を満たす場合のみ保存処理を実行
				await env.MY_BUCKET.put(key, request.body);
				return new Response(`Put ${key} successfully!`);

			case 'GET':
				// HTMLページを返す
				return new Response(HTML, {
					status: 200,
					headers: {
						'Content-Type': 'text/html',
					},
				});

			default:
				return new Response('Method Not Allowed', {
					status: 405,
					headers: {
						Allow: 'PUT, GET',
					},
				});
		}
	},
};
