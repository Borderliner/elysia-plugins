import { Elysia } from 'elysia'
import { LRUCache } from 'lru-cache'
import { loggerPlugin } from './logger.plugin.js'

interface RateLimitOptions {
  maxRequests?: number
  duration?: number
  keyGenerator?: (request: Request) => string
  errorResponse?: string | ((request: Request) => any)
  skip?: (request: Request, key: string) => boolean | Promise<boolean>
}

interface RateLimitContext {
  get(key: string): { count: number; reset: number } | undefined
  set(key: string, value: { count: number; reset: number }): void
}

class DefaultRateLimitContext implements RateLimitContext {
  private cache: LRUCache<string, { count: number; reset: number }>

  constructor(maxEntries: number = 10000) {
    this.cache = new LRUCache({
      max: maxEntries,
      ttl: 1 * 3600 * 1000, // 1 hour
    })
  }

  get(key: string) {
    return this.cache.get(key)
  }

  set(key: string, value: { count: number; reset: number }) {
    this.cache.set(key, value)
  }
}

export const rateLimitPlugin = (options: RateLimitOptions = {}) => {
  const defaultKeyGenerator = (request: Request) =>
    request.headers
      .entries()
      .filter(([key, _]) =>
        ['x-forwareded-for', 'x-real-ip', 'forwarded'].includes(
          key.trim().toLowerCase()
        )
      )
      .map((v) => v.at(1))
      .toArray()
      .at(0) ?? 'unknown'
  const {
    maxRequests = 100,
    duration = 60 * 1000,
    keyGenerator = defaultKeyGenerator,
    errorResponse = 'Too many requests',
    skip = () => false,
  } = options

  const context = new DefaultRateLimitContext()

  return new Elysia({ name: 'Rate Limit Plugin', seed: options })
    .use(loggerPlugin())
    .onRequest(async ({ request, set, store }) => {
      const key = keyGenerator(request)
      if (await skip(request, key)) return

      const now = Date.now()
      const resetTime = now + duration

      let entry = context.get(key)
      if (!entry || now > entry.reset) {
        entry = { count: 0, reset: resetTime }
      }

      entry.count += 1
      context.set(key, entry)

      set.headers['RateLimit-Limit'] = maxRequests.toString()
      set.headers['RateLimit-Remaining'] = Math.max(
        0,
        maxRequests - entry.count
      ).toString()
      set.headers['RateLimit-Reset'] = Math.ceil(entry.reset / 1000).toString()

      if (entry.count > maxRequests) {
        set.status = 429
        set.headers['Retry-After'] = Math.ceil(duration / 1000).toString()
        // Log rate limit exceeded
        store.logger.log('warn', `Rate limit exceeded for key: ${key}`)
        return typeof errorResponse === 'function'
          ? errorResponse(request)
          : errorResponse
      }

      // Log successful request
      /* store.logger.log(
        'info',
        `Rate limit check passed for key: ${key} (${entry.count}/${maxRequests})`
      ) */
    })
}
