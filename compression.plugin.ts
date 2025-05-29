import { Elysia, StatusMap } from 'elysia'
import { brotliCompressSync, gzipSync, deflateSync } from 'node:zlib'
import { loggerPlugin } from './logger.plugin.js'

type Scope = 'global' | 'scoped' | 'local'

const compressors = {
  br: (buffer: Buffer) => brotliCompressSync(buffer),
  gzip: (buffer: Buffer) => gzipSync(buffer),
  deflate: (buffer: Buffer) => deflateSync(buffer),
} as const

type Encoding = keyof typeof compressors

function isValidEncoding(encoding: string): encoding is Encoding {
  return encoding in compressors
}

type CompressorOptions = {
  encodings?: Encoding
  threshold?: number
  scope?: Scope
  ttl?: number
}

export const compressionPlugin = (options: CompressorOptions = {}) => {
  const {
    encodings = ['br', 'gzip', 'deflate'] as const,
    threshold = 1024,
    scope = 'scoped' as Scope,
    ttl = 0,
  } = options
  return new Elysia({ name: 'Compression Plugin', seed: options })
    .use(loggerPlugin())
    .mapResponse({ as: scope }, ({ response, headers = {}, set, store }) => {
      // Pass through if response is already a Response object
      if (response instanceof Response) {
        // Skip compression if Content-Encoding is already set
        if (response.headers.get('Content-Encoding')) {
          return response
        }
        // Optionally, apply ttl headers if not present
        const responseHeaders: Record<string, string> = {}
        if (ttl > 0 && !response.headers.get('Cache-Control')) {
          responseHeaders['Cache-Control'] = `public, max-age=${ttl}`
          responseHeaders['Expires'] = new Date(
            Date.now() + ttl * 1000
          ).toUTCString()
        }
        return new Response(response.body, {
          status: response.status,
          headers: mergeRecords(
            responseHeaders,
            Object.fromEntries(response.headers)
          ),
        })
      }

      // Handle Error responses
      if (response instanceof Error) {
        return new Response(response.message, {
          status: normalizeStatusCode(set.status),
          headers: mergeRecords(
            { 'Content-Type': 'text/plain; charset=utf-8' },
            headers
          ),
        })
      }

      // Convert response to string
      const isJson =
        typeof response === 'object' &&
        response !== null &&
        !(response instanceof Buffer)
      const text = isJson
        ? JSON.stringify(response)
        : response?.toString() ?? ''
      const buffer = Buffer.from(text, 'utf-8')

      // Initialize headers
      const responseHeaders: typeof headers = {
        'Content-Type': `${
          isJson ? 'application/json' : 'text/plain'
        }; charset=utf-8`,
      }

      // Add cache headers
      if (ttl > 0) {
        responseHeaders['Cache-Control'] = `public, max-age=${ttl}`
        responseHeaders['Expires'] = new Date(
          Date.now() + ttl * 1000
        ).toUTCString()
      } else {
        responseHeaders['Cache-Control'] = 'no-cache'
      }

      // Skip compression if below threshold
      if (buffer.length < threshold) {
        return new Response(text, {
          headers: mergeRecords(responseHeaders, headers),
          status: normalizeStatusCode(set.status),
        })
      }

      // Parse Accept-Encoding
      const acceptEncoding = headers['accept-encoding'] || ''
      const encoding = acceptEncoding
        .split(',')
        .map((enc) => {
          const [name, q = '1'] = enc.trim().split(';q=')
          return { name, q: parseFloat(q) }
        })
        .filter(
          (enc): enc is { name: Encoding; q: number } =>
            isValidEncoding(enc.name) && encodings.includes(enc.name)
        )
        .sort((a, b) => b.q - a.q)[0]?.name

      // Return uncompressed if no supported encoding
      if (!encoding) {
        return new Response(text, {
          headers: mergeRecords(responseHeaders, headers),
          status: normalizeStatusCode(set.status),
        })
      }

      // Compress response
      let compressed: Buffer
      try {
        compressed = compressors[encoding](buffer)
      } catch (error) {
        store.logger.log(
          'error',
          `Compression failed with ${encoding}: ${error}`
        )
        return new Response(text, {
          headers: mergeRecords(responseHeaders, headers),
          status: normalizeStatusCode(set.status),
        })
      }

      // Add compression headers
      responseHeaders['Content-Encoding'] = encoding
      responseHeaders['Content-Length'] = compressed.length.toString()

      return new Response(compressed, {
        headers: mergeRecords(responseHeaders, headers),
        status: normalizeStatusCode(set.status),
      })
    })
}

const normalizeStatusCode = (code: number | keyof StatusMap | undefined) =>
  typeof code === 'string' ? StatusMap[code] : code ?? 200

function mergeRecords(
  first: Record<string, string | undefined> | null | undefined,
  second: Record<string, string | undefined> | null | undefined
): Record<string, string> {
  const result: Record<string, string> = {}

  if (first) {
    for (const [key, value] of Object.entries(first)) {
      if (value !== undefined) {
        result[key.toLowerCase()] = value
      }
    }
  }

  if (second) {
    for (const [key, value] of Object.entries(second)) {
      const lowerKey = key.toLowerCase()
      if (!(lowerKey in result) && value !== undefined) {
        result[lowerKey] = value
      }
    }
  }

  return result
}
