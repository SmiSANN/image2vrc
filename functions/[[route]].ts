import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon/workerd'

type Bindings = {
	MY_BUCKET: R2Bucket
}

const UUID_LENGTH = 36
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
const MAX_INPUT_SIZE = 20 * 1024 * 1024
const RESIZE_THRESHOLD = 2048

function detectImageMimeType(buf: ArrayBuffer): string | null {
	const b = new Uint8Array(buf)
	// PNG マジックバイト
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
	// JPEG マジックバイト
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
	// WebP (RIFF????WEBP)
	if (
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	)
		return 'image/webp'
	// GIF87a / GIF89a マジックバイト
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
	return null
}

async function urlToKey(url: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
	return 'p-' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function resizeIfNeeded(
	buffer: ArrayBuffer,
	mimeType: string,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
	if (mimeType === 'image/gif') return { buffer, mimeType }

	let img: PhotonImage | null = null
	let resized: PhotonImage | null = null
	try {
		img = PhotonImage.new_from_byteslice(new Uint8Array(buffer))
		const width = img.get_width()
		const height = img.get_height()
		if (width <= RESIZE_THRESHOLD && height <= RESIZE_THRESHOLD) return { buffer, mimeType }

		const scale = RESIZE_THRESHOLD / Math.max(width, height)
		const newWidth = Math.max(1, Math.floor(width * scale))
		const newHeight = Math.max(1, Math.floor(height * scale))
		resized = resize(img, newWidth, newHeight, SamplingFilter.Lanczos3)

		let outBytes: Uint8Array
		let outMime: string
		if (mimeType === 'image/jpeg') {
			outBytes = resized.get_bytes_jpeg(85)
			outMime = 'image/jpeg'
		} else if (mimeType === 'image/webp') {
			outBytes = resized.get_bytes_webp()
			outMime = 'image/webp'
		} else {
			outBytes = resized.get_bytes()
			outMime = 'image/png'
		}
		return { buffer: outBytes.buffer as ArrayBuffer, mimeType: outMime }
	} finally {
		img?.free()
		resized?.free()
	}
}

export const app = new Hono<{ Bindings: Bindings }>()

app.post('/fetch-url', async (c) => {
	const url = await c.req.text()
	if (!url) return c.text('URL を入力してください', 400)

	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return c.text('不正な URL です', 400)
	}
	if (parsed.protocol !== 'https:') return c.text('https: スキームのみ対応しています', 400)

	let upstream: Response
	try {
		upstream = await fetch(url)
	} catch {
		return c.text('外部 URL の取得に失敗しました', 502)
	}

	const buffer = await upstream.arrayBuffer()
	if (buffer.byteLength > MAX_INPUT_SIZE) return c.text('20MB 以下にしてください', 413)

	const mimeType = detectImageMimeType(buffer)
	if (!mimeType) return c.text('対応していないファイル形式です（PNG/JPEG/WebP/GIF のみ）', 415)

	const { buffer: outBuffer, mimeType: outMime } = await resizeIfNeeded(buffer, mimeType)

	const uuid = crypto.randomUUID()
	await c.env.MY_BUCKET.put(uuid, outBuffer, {
		httpMetadata: { contentType: outMime },
	})
	return c.text(uuid)
})

app.get('/proxy', async (c) => {
	const url = c.req.query('url')
	if (!url) return c.text('url パラメータが必要です', 400)

	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return c.text('不正な URL です', 400)
	}
	if (parsed.protocol !== 'https:') return c.text('https: スキームのみ対応しています', 400)

	const key = await urlToKey(url)

	const cached = await c.env.MY_BUCKET.get(key)
	if (cached) {
		return new Response(cached.body, {
			headers: {
				'Content-Type': cached.httpMetadata?.contentType ?? 'image/png',
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		})
	}

	let upstream: Response
	try {
		upstream = await fetch(url)
	} catch {
		return c.text('外部 URL の取得に失敗しました', 502)
	}

	const buffer = await upstream.arrayBuffer()
	if (buffer.byteLength > MAX_INPUT_SIZE) return c.text('20MB 以下にしてください', 413)

	const mimeType = detectImageMimeType(buffer)
	if (!mimeType) return c.text('対応していないファイル形式です（PNG/JPEG/WebP/GIF のみ）', 415)

	const { buffer: outBuffer, mimeType: outMime } = await resizeIfNeeded(buffer, mimeType)

	await c.env.MY_BUCKET.put(key, outBuffer, {
		httpMetadata: { contentType: outMime },
	})
	return new Response(outBuffer, {
		headers: {
			'Content-Type': outMime,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	})
})

app.put('/:uuid', async (c) => {
	const key = c.req.param('uuid')
	if (key.length !== UUID_LENGTH) return c.text('不正なリクエスト', 400)

	const cl = c.req.header('Content-Length')
	if (cl && parseInt(cl) > MAX_UPLOAD_SIZE) return c.text('5MB 以下にしてください', 413)

	const buffer = await c.req.arrayBuffer()
	if (buffer.byteLength > MAX_UPLOAD_SIZE) return c.text('5MB 以下にしてください', 413)
	if (buffer.byteLength === 0) return c.text('空のファイルです', 400)

	const mimeType = detectImageMimeType(buffer)
	if (!mimeType) return c.text('対応していないファイル形式です（PNG/JPEG/WebP/GIF のみ）', 415)

	await c.env.MY_BUCKET.put(key, buffer, {
		httpMetadata: { contentType: mimeType },
	})
	return c.text(`Put ${key} successfully!`)
})

app.get('/:uuid', async (c) => {
	const key = c.req.param('uuid')
	if (key.length !== UUID_LENGTH) return c.notFound()

	const obj = await c.env.MY_BUCKET.get(key)
	if (!obj) return c.notFound()

	return new Response(obj.body, {
		headers: {
			'Content-Type': obj.httpMetadata?.contentType ?? 'image/png',
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	})
})

export const onRequest = handle(app)
export default app
