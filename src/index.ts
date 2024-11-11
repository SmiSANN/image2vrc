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
</head>
<body>
  <h1>Image to VRC</h1>
  <p>VRCのUnityWebRequestTexture向けに画像をアップロードできる</p>

  <input type="file" id="fileInput" accept="image/png, image/jpeg">
  <button onclick="uploadImage()">Upload Image</button>

  <p>又はクリップボードから貼り付け</p>
  <img id="preview" style="max-width: 32%; display: none;">
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
      if (!blob) {
        const fileInput = document.getElementById("fileInput");
        const file = fileInput.files[0];
        if (!file) {
          alert("Please select a file first.");
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
          alert("Image uploaded successfully!");
          const url = \`https://image2vrc.smisann.net/\${timestampKey}\`;
          await navigator.clipboard.writeText(url);
          alert("URL copied to clipboard: " + url);
          window.location.reload();
        } else {
          console.error("Failed to upload image:", response.statusText);
        }
      } catch (error) {
        console.error("Error:", error);
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
</body>
</html>`;


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
