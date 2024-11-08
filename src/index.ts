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

const notFoundHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Object Not Found</title>
</head>
<body>
  <h1>Image2VRC</h1>
  
  <!-- ファイル選択用のinput -->
  <input type="file" id="fileInput" accept="image/png">
  <button onclick="uploadImage()">Upload Image</button>
  
  <script>
    async function uploadImage() {
      const fileInput = document.getElementById("fileInput");
      const file = fileInput.files[0];
      if (!file) {
        alert("Please select a file first.");
        return;
      }
      
      try {
        const response = await fetch("/mykey", {  // /mykeyにアップロード
          method: "PUT",
          headers: {
            "Content-Type": "image/png"
          },
          body: file
        });
        
        if (response.ok) {
          alert("Image uploaded successfully!");
          window.location.reload();
        } else {
          console.error("Failed to upload image:", response.statusText);
        }
      } catch (error) {
        console.error("Error:", error);
      }
    }
  </script>
</body>
</html>
`;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const key = url.pathname.slice(1);

		switch (request.method) {
			case 'PUT':
				if (key !== "mykey") {
					return new Response('Key not allowed', { status: 403 });
				}
				await env.MY_BUCKET.put(key, request.body);
				return new Response(`Put ${key} successfully!`);
			case 'GET':
				const object = await env.MY_BUCKET.get(key);

				if (object === null) {
					return new Response(notFoundHtml, {
						status: 404,
						headers: {
							"Content-Type": "text/html"
						}
					});
				}

				const headers = new Headers();
				object.writeHttpMetadata(headers);
				headers.set('etag', object.httpEtag);

				return new Response(object.body, {
					headers,
				});
			default:
				return new Response('Method Not Allowed', {
					status: 405,
					headers: {
						Allow: 'PUT, GET, DELETE',
					},
				});
		}
	},
};
