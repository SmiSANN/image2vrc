import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import worker from '../functions/[[route]]'

const VALID_UUID = '00000000-0000-0000-0000-000000000000'

async function makePng(width: number, height: number): Promise<Uint8Array> {
	const crcTable = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		crcTable[n] = c
	}
	const crc32 = (d: Uint8Array) => {
		let c = 0xffffffff
		for (const b of d) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
		return (c ^ 0xffffffff) >>> 0
	}
	const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
	const chunk = (type: number[], data: number[]) => {
		const crcIn = new Uint8Array([...type, ...data])
		return [...u32(data.length), ...type, ...data, ...u32(crc32(crcIn))]
	}

	// グレースケール 8bit: 各行 = フィルタバイト 0x00 + 幅分のゼロバイト
	const raw = new Uint8Array((1 + width) * height)
	const cs = new CompressionStream('deflate')
	const writer = cs.writable.getWriter()
	writer.write(raw); writer.close()
	const parts: Uint8Array[] = []
	const reader = cs.readable.getReader()
	while (true) { const { done, value } = await reader.read(); if (done) break; parts.push(value!) }
	const idatData = [...parts.flatMap(p => [...p])]

	return new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		...chunk([0x49, 0x48, 0x44, 0x52], [...u32(width), ...u32(height), 0x08, 0x00, 0x00, 0x00, 0x00]),
		...chunk([0x49, 0x44, 0x41, 0x54], idatData),
		...chunk([0x49, 0x45, 0x4e, 0x44], []),
	])
}

// 各対応フォーマットのマジックバイト
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00])
const WEBP_BYTES = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, // RIFF
	0x00, 0x00, 0x00, 0x00, // ファイルサイズ（ダミー）
	0x57, 0x45, 0x42, 0x50, // WEBP
])
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00])
const INVALID_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09])

async function putImage(uuid: string, body: Uint8Array): Promise<Response> {
	const ctx = createExecutionContext()
	const res = await worker.fetch(
		new Request(`http://example.com/${uuid}`, {
			method: 'PUT',
			body: body,
		}),
		env,
		ctx,
	)
	await waitOnExecutionContext(ctx)
	return res
}

async function getImage(uuid: string): Promise<Response> {
	const ctx = createExecutionContext()
	const res = await worker.fetch(
		new Request(`http://example.com/${uuid}`, { method: 'GET' }),
		env,
		ctx,
	)
	await waitOnExecutionContext(ctx)
	return res
}

describe('PUT /:uuid', () => {
	it('accepts PNG by magic bytes', async () => {
		const res = await putImage(VALID_UUID, PNG_BYTES)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(`Put ${VALID_UUID} successfully!`)
	})

	it('accepts JPEG by magic bytes', async () => {
		const res = await putImage(VALID_UUID, JPEG_BYTES)
		expect(res.status).toBe(200)
	})

	it('accepts WebP by magic bytes', async () => {
		const res = await putImage(VALID_UUID, WEBP_BYTES)
		expect(res.status).toBe(200)
	})

	it('accepts GIF by magic bytes', async () => {
		const res = await putImage(VALID_UUID, GIF_BYTES)
		expect(res.status).toBe(200)
	})

	it('rejects unknown file format with 415', async () => {
		const res = await putImage(VALID_UUID, INVALID_BYTES)
		expect(res.status).toBe(415)
	})

	it('rejects empty body with 400', async () => {
		const res = await putImage(VALID_UUID, new Uint8Array([]))
		expect(res.status).toBe(400)
	})

	it('rejects invalid UUID length with 400', async () => {
		const res = await putImage('short-uuid', PNG_BYTES)
		expect(res.status).toBe(400)
	})
})

describe('POST /fetch-url', () => {
	beforeAll(() => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
	})
	afterAll(() => fetchMock.deactivate())

	async function postFetchUrl(body: string): Promise<Response> {
		const ctx = createExecutionContext()
		const res = await worker.fetch(
			new Request('http://example.com/fetch-url', { method: 'POST', body }),
			env,
			ctx,
		)
		await waitOnExecutionContext(ctx)
		return res
	}

	it('rejects empty body with 400', async () => {
		const res = await postFetchUrl('')
		expect(res.status).toBe(400)
	})

	it('rejects http:// URL with 400', async () => {
		const res = await postFetchUrl('http://example.com/image.png')
		expect(res.status).toBe(400)
	})

	it('rejects invalid URL with 400', async () => {
		const res = await postFetchUrl('not-a-url')
		expect(res.status).toBe(400)
	})

	it('accepts valid https URL and returns UUID', async () => {
		const pngBytes = await makePng(10, 10)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/fetch-url-test.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await postFetchUrl('https://example.com/fetch-url-test.png')
		expect(res.status).toBe(200)
		const uuid = await res.text()
		expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
	})

	it('does not resize small image (100x100)', async () => {
		const pngBytes = await makePng(100, 100)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/small.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await postFetchUrl('https://example.com/small.png')
		expect(res.status).toBe(200)
		const uuid = await res.text()

		const imgRes = await getImage(uuid)
		expect(imgRes.status).toBe(200)
		const buf = await imgRes.arrayBuffer()
		const storedWidth = new DataView(buf).getUint32(16)
		expect(storedWidth).toBe(100)
	})

	it('resizes large image (3000x1) to <= 2048px wide', async () => {
		const pngBytes = await makePng(3000, 1)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/large.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await postFetchUrl('https://example.com/large.png')
		expect(res.status).toBe(200)
		const uuid = await res.text()

		const imgRes = await getImage(uuid)
		expect(imgRes.status).toBe(200)
		const buf = await imgRes.arrayBuffer()
		const storedWidth = new DataView(buf).getUint32(16)
		expect(storedWidth).toBeLessThanOrEqual(2048)
	})

	it('passes GIF through without resizing', async () => {
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/anim.gif' })
			.reply(200, Buffer.from(GIF_BYTES), { headers: { 'Content-Type': 'image/gif' } })

		const res = await postFetchUrl('https://example.com/anim.gif')
		expect(res.status).toBe(200)
	})

	it('rejects image over 20MB with 413', async () => {
		const bigBuffer = Buffer.alloc(21 * 1024 * 1024)
		// サイズチェックに到達するよう PNG マジックバイトを書き込む
		bigBuffer[0] = 0x89; bigBuffer[1] = 0x50; bigBuffer[2] = 0x4e; bigBuffer[3] = 0x47
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/huge.png' })
			.reply(200, bigBuffer, { headers: { 'Content-Type': 'image/png' } })

		const res = await postFetchUrl('https://example.com/huge.png')
		expect(res.status).toBe(413)
	})
})

describe('GET /proxy', () => {
	beforeAll(() => {
		fetchMock.activate()
		fetchMock.disableNetConnect()
	})
	afterAll(() => fetchMock.deactivate())

	async function getProxy(url?: string): Promise<Response> {
		const ctx = createExecutionContext()
		const reqUrl =
			url !== undefined
				? `http://example.com/proxy?url=${encodeURIComponent(url)}`
				: 'http://example.com/proxy'
		const res = await worker.fetch(new Request(reqUrl, { method: 'GET' }), env, ctx)
		await waitOnExecutionContext(ctx)
		return res
	}

	it('rejects missing url param with 400', async () => {
		const res = await getProxy()
		expect(res.status).toBe(400)
	})

	it('rejects http:// URL with 400', async () => {
		const res = await getProxy('http://example.com/image.png')
		expect(res.status).toBe(400)
	})

	it('fetches and returns image with correct headers', async () => {
		const pngBytes = await makePng(10, 10)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/proxy-test.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await getProxy('https://example.com/proxy-test.png')
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('image/png')
		expect(res.headers.get('Cache-Control')).toContain('immutable')
		await res.arrayBuffer()
	})

	it('returns cached response on second request without calling fetch again', async () => {
		const pngBytes = await makePng(10, 10)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/cached-image.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res1 = await getProxy('https://example.com/cached-image.png')
		expect(res1.status).toBe(200)
		await res1.arrayBuffer()

		// 2回目のリクエスト: R2 キャッシュヒット — fetch が再度呼ばれてはいけない
		// （インターセプト未登録; fetch が呼ばれると disableNetConnect() により 502 になる）
		const res2 = await getProxy('https://example.com/cached-image.png')
		expect(res2.status).toBe(200)
		expect(res2.headers.get('Content-Type')).toBe('image/png')
		await res2.arrayBuffer()
	})

	it('rejects non-image response with 415', async () => {
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/not-an-image.txt' })
			.reply(200, Buffer.from(INVALID_BYTES), { headers: { 'Content-Type': 'text/plain' } })

		const res = await getProxy('https://example.com/not-an-image.txt')
		expect(res.status).toBe(415)
	})

	it('does not resize small image (100x100)', async () => {
		const pngBytes = await makePng(100, 100)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/proxy-small.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await getProxy('https://example.com/proxy-small.png')
		expect(res.status).toBe(200)
		const buf = await res.arrayBuffer()
		const storedWidth = new DataView(buf).getUint32(16)
		expect(storedWidth).toBe(100)
	})

	it('resizes large image (3000x1) to <= 2048px wide', async () => {
		const pngBytes = await makePng(3000, 1)
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/proxy-large.png' })
			.reply(200, Buffer.from(pngBytes), { headers: { 'Content-Type': 'image/png' } })

		const res = await getProxy('https://example.com/proxy-large.png')
		expect(res.status).toBe(200)
		const buf = await res.arrayBuffer()
		const storedWidth = new DataView(buf).getUint32(16)
		expect(storedWidth).toBeLessThanOrEqual(2048)
	})

	it('passes GIF through without resizing', async () => {
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/proxy-anim.gif' })
			.reply(200, Buffer.from(GIF_BYTES), { headers: { 'Content-Type': 'image/gif' } })

		const res = await getProxy('https://example.com/proxy-anim.gif')
		expect(res.status).toBe(200)
		await res.arrayBuffer()
	})

	it('rejects image over 20MB with 413', async () => {
		const bigBuffer = Buffer.alloc(21 * 1024 * 1024)
		bigBuffer[0] = 0x89; bigBuffer[1] = 0x50; bigBuffer[2] = 0x4e; bigBuffer[3] = 0x47
		fetchMock
			.get('https://example.com')
			.intercept({ path: '/proxy-huge.png' })
			.reply(200, bigBuffer, { headers: { 'Content-Type': 'image/png' } })

		const res = await getProxy('https://example.com/proxy-huge.png')
		expect(res.status).toBe(413)
	})
})

describe('GET /:uuid', () => {
	it('returns 404 for non-existent object', async () => {
		const uuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
		const res = await getImage(uuid)
		expect(res.status).toBe(404)
	})

	it('returns 404 for invalid UUID length', async () => {
		const res = await getImage('short-uuid')
		expect(res.status).toBe(404)
	})

	it('returns image with correct headers after PUT', async () => {
		const uuid = '11111111-1111-1111-1111-111111111111'
		await putImage(uuid, PNG_BYTES)
		const res = await getImage(uuid)
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('image/png')
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
		await res.arrayBuffer() // R2 ストリームを解放するためにボディを消費
	})

	it('stores detected MIME type regardless of Content-Type header', async () => {
		const uuid = '22222222-2222-2222-2222-222222222222'
		const ctx = createExecutionContext()
		// JPEG バイトを送信するが Content-Type は text/plain と偽る
		const res = await worker.fetch(
			new Request(`http://example.com/${uuid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'text/plain' },
				body: JPEG_BYTES,
			}),
			env,
			ctx,
		)
		await waitOnExecutionContext(ctx)
		expect(res.status).toBe(200)

		const imgRes = await getImage(uuid)
		expect(imgRes.headers.get('Content-Type')).toBe('image/jpeg')
		await imgRes.arrayBuffer() // R2 ストリームを解放するためにボディを消費
	})
})
