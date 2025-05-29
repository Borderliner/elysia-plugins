# Elysia Plugins

A collection of plugins for the [Elysia](https://elysiajs.com/) framework, providing logging, rate limiting, and compression functionalities. Available on npm as `@borderliner/elysia-plugins`.

## Installation

Install the package via npm:

```bash
npm install @borderliner/elysia-plugins
```

## Plugins

### Logger Plugin

The `loggerPlugin` provides request logging with console output and optional file logging. It supports customizable log levels, file paths, and formatting.

#### Usage

```javascript
import { Elysia } from 'elysia'
import { loggerPlugin } from '@borderliner/elysia-plugins'

const app = new Elysia()
  .use(loggerPlugin({
    logLevel: 'info', // Minimum log level: 'debug', 'info', 'warn', 'error'
    filePath: './logs/app.log', // Optional file path for logs
    scope: 'scoped', // Scope: 'local', 'scoped', 'global'
    format: ({ request }, responseTime, status) => 
      `${new Date().toISOString()} [${request.method}] ${request.url} ${status} ${responseTime.toFixed(2)}ms`
  }))
  .get('/', () => 'Hello, World!')
  .listen(3000)
```

#### Options

- `logLevel` (optional): Minimum log level (`'debug'`, `'info'`, `'warn'`, `'error'`). Default: `'info'`.
- `filePath` (optional): Path for log files (e.g., `'./logs/app.log'`). Logs are saved with a daily suffix (e.g., `app-2025-05-29T00.log`).
- `scope` (optional): Plugin scope (`'local'`, `'scoped'`, `'global'`). Default: `'scoped'`.
- `format` (optional): Custom formatter function for log messages. Receives `Context` (`request`), `responseTime`, and `status`. Default format: `YYYY-MM-DDTHH:mm:ss.sssZ [METHOD] URL STATUS RESPONSE_TIMEms`.

#### Features

- Color-coded console logs for different log levels.
- Automatic daily log file rotation.
- Asynchronous file writing with queue management.
- Flushes pending file writes on server stop.

### Rate Limit Plugin

The `rateLimitPlugin` restricts the number of requests per client within a time window, using an LRU cache for tracking.

#### Usage

```javascript
import { Elysia } from 'elysia'
import { rateLimitPlugin } from '@borderliner/elysia-plugins'

const app = new Elysia()
  .use(rateLimitPlugin({
    maxRequests: 100, // Max requests per duration
    duration: 60 * 1000, // Time window in milliseconds
    keyGenerator: (request) => request.headers.get('x-forwarded-for') || 'unknown',
    errorResponse: 'Rate limit exceeded. Please try again later.',
    skip: (request, key) => key === 'trusted-ip'
  }))
  .get('/', () => 'Hello, World!')
  .listen(3000)
```

#### Options

- `maxRequests` (optional): Maximum requests allowed in the time window. Default: `100`.
- `duration` (optional): Time window in milliseconds. Default: `60000` (1 minute).
- `keyGenerator` (optional): Function to generate a unique key for each request (e.g., based on IP). Default: Uses `x-forwarded-for`, `x-real-ip`, or `forwarded` headers.
- `errorResponse` (optional): Custom response for rate limit exceeded (string or function). Default: `'Too many requests'`.
- `skip` (optional): Function to bypass rate limiting for specific requests. Default: `() => false`.

#### Features

- Sets `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.
- Returns `429 Too Many Requests` with `Retry-After` header when limit is exceeded.
- Integrates with `loggerPlugin` for logging rate limit events.
- Uses LRU cache with a default max of 10,000 entries and 1-hour TTL.

### Compression Plugin

The `compressionPlugin` compresses HTTP responses using Brotli, Gzip, or Deflate based on the client's `Accept-Encoding` header.

#### Usage

```javascript
import { Elysia } from 'elysia'
import { compressionPlugin } from '@borderliner/elysia-plugins'

const app = new Elysia()
  .use(compressionPlugin({
    encodings: ['br', 'gzip', 'deflate'], // Supported encodings
    threshold: 1024, // Minimum response size for compression (bytes)
    scope: 'scoped', // Scope: 'local', 'scoped', 'global'
    ttl: 3600 // Cache TTL in seconds
  }))
  .get('/', () => ({ message: 'Hello, World!' }))
  .listen(3000)
```

#### Options

- `encodings` (optional): Supported compression encodings (`'br'`, `'gzip'`, `'deflate'`). Default: `['br', 'gzip', 'deflate']`.
- `threshold` (optional): Minimum response size (in bytes) to compress. Default: `1024`.
- `scope` (optional): Plugin scope (`'local'`, `'scoped'`, `'global'`). Default: `'scoped'`.
- `ttl` (optional): Cache TTL in seconds for `Cache-Control` and `Expires` headers. Default: `0` (no cache).

#### Features

- Automatically selects the best encoding based on `Accept-Encoding` and quality values.
- Skips compression for responses below the threshold or with existing `Content-Encoding`.
- Sets `Content-Encoding` and `Content-Length` headers for compressed responses.
- Adds `Cache-Control` and `Expires` headers if `ttl` is specified.
- Integrates with `loggerPlugin` for logging compression errors.
- Supports JSON and text responses.

## License

This project is licensed under the [Apache-2.0 License](https://www.apache.org/licenses/LICENSE-2.0).

