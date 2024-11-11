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

const HTML = `
<!DOCTYPE html>
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
    <button id="uploadButton" onclick="uploadImage()">Upload Image</button>

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

    <script>
      async function resizeImage(file, format = "image/png") {
        const img = new Image();
        img.src = URL.createObjectURL(file);

        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const maxDimension = 2048;
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          const scaleFactor = maxDimension / Math.max(width, height);
          width = Math.round(width * scaleFactor);
          height = Math.round(height * scaleFactor);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        
        return new Promise((resolve) => {
          canvas.toBlob((blob) => resolve(blob), format);
        });
      }

      function showPreview(file) {
        const preview = document.getElementById("preview");
        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
      }

      async function uploadImage(blob, format = "image/png") {
        const statusMessage = document.getElementById("statusMessage");
        statusMessage.innerText = "LOADING";
        statusMessage.style.color = "black";

        if (!blob) {
          const fileInput = document.getElementById("fileInput");
          const file = fileInput.files[0];
          if (!file) {
            statusMessage.innerText = "No file selected.";
            return;
          }
          blob = await resizeImage(file, file.type);
          format = file.type;
          showPreview(file);
        }

        const timestampKey = new Date().getTime().toString();
        try {
          const response = await fetch(\`/\${timestampKey}\`, {
            method: "PUT",
            headers: {
              "Content-Type": format
            },
            body: blob
          });

          if (response.ok) {
            statusMessage.innerText = "SUCCESS";
            statusMessage.style.color = "green";
            const url = \`https://image2vrc.smisann.net/\${timestampKey}\`;
            displayRecentUrl(url);
            await navigator.clipboard.writeText(url); // 自動でクリップボードにコピー
          } else {
            statusMessage.innerText = "FAIL";
            statusMessage.style.color = "red";
          }
        } catch (error) {
          statusMessage.innerText = "FAIL";
          statusMessage.style.color = "red";
          console.error("Error:", error);
        }
      }

      function displayRecentUrl(url) {
        const recentUrlElement = document.getElementById("recentUrl");
        const copyButton = document.getElementById("copyButton");

        recentUrlElement.innerText = url;
        copyButton.style.display = "inline";
      }

      async function copyToClipboard() {
        const recentUrl = document.getElementById("recentUrl").innerText;
        try {
          await navigator.clipboard.writeText(recentUrl);
        } catch (error) {
          console.error("Failed to copy URL:", error);
        }
      }

      document.getElementById("fileInput").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
          showPreview(file);
        }
      });

      document.addEventListener("paste", async (event) => {
        const items = event.clipboardData.items;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            showPreview(blob);
            const resizedBlob = await resizeImage(blob, blob.type);
            uploadImage(resizedBlob, blob.type);
            break;
          }
        }
      });
    </script>
  </div>
</body>
</html>
`;





export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const key = url.pathname.slice(1);

		switch (request.method) {
			case 'PUT':
				// Content-Lengthヘッダーを取得
				const contentLength = request.headers.get('Content-Length');

				// Content-Lengthが5MB（5 * 1024 * 1024バイト）以下であるか確認
				if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
					return new Response('ファイルが大きすぎます。最大サイズは5MBです。', { status: 413 }); // 413 Payload Too Large
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
