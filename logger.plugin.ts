import { Elysia, StatusMap, type Context } from 'elysia'
import { mkdir, appendFile } from 'node:fs/promises'

const COLORS = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  timestamp: '\x1b[90m',
  method: '\x1b[35m',
  url: '\x1b[34m',
  status: '\x1b[32m',
  responseTime: '\x1b[36m',
  reset: '\x1b[0m',
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  logLevel?: LogLevel
  filePath?: string
  scope?: 'local' | 'scoped' | 'global'
  format?: (
    ctx: Pick<Context, 'request'>,
    responseTime: number,
    status: number
  ) => string
}

class Logger {
  private fileWriteQueue = new Set<Promise<void>>()

  constructor(private options: LoggerOptions) {}

  log(
    level: LogLevel,
    message: string,
    ctx?: { request: Request; responseTime?: number; status?: number }
  ) {
    if (!this.shouldLog(level, this.options.logLevel || 'info')) return

    const formattedMessage = message || '' // Use message directly or empty string

    this.logToConsole(
      level,
      formattedMessage,
      ctx || {
        request: new Request('http://localhost'),
        responseTime: 0,
        status: 200,
      }
    )

    if (this.options.filePath) {
      const dailyFilePath = this.getDailyFilePath(this.options.filePath)
      // Use the same format as logToConsole for file logging
      const fileMessage = ctx
        ? `${new Date().toISOString()} [${ctx.request.method}] ${
            ctx.request.url
          } ${ctx.status || 200} ${(ctx.responseTime || 0).toFixed(2)}ms`
        : formattedMessage
      const writePromise = this.logToFile(dailyFilePath, `${fileMessage}\n`)
      this.fileWriteQueue.add(writePromise)
      writePromise.finally(() => this.fileWriteQueue.delete(writePromise))
    }
  }

  private shouldLog(messageLevel: LogLevel, minLevel: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    }
    return levels[messageLevel] >= levels[minLevel]
  }

  private logToConsole(
    level: LogLevel,
    message: string,
    {
      request,
      responseTime,
      status,
    }: { request: Request; responseTime?: number; status?: number }
  ): void {
    const color = COLORS[level]
    const timestamp = new Date().toISOString()
    const method = request.method
    const url = request.url
    const formattedMessage = `${color}[${level.toUpperCase()}]${COLORS.reset} ${
      COLORS.timestamp
    }${timestamp}${COLORS.reset} ${COLORS.method}${method}${COLORS.reset} ${
      COLORS.url
    }${url}${COLORS.reset} ${COLORS.status}${status}${COLORS.reset} ${
      COLORS.responseTime
    }${responseTime?.toFixed(2)}ms${COLORS.reset}${
      message ? `: ${message}` : ''
    }`
    console.log(formattedMessage)
  }

  private getDailyFilePath(basePath: string): string {
    const date = new Date().toISOString().split(':')[0]
    const ext = basePath.split('.').pop()
    const baseName = basePath.substring(0, basePath.lastIndexOf('.'))
    return `${baseName}-${date}.${ext}`
  }

  private async logToFile(filePath: string, message: string): Promise<void> {
    try {
      const dir = filePath.split('/').slice(0, -1).join('/')
      if (dir) await mkdir(dir, { recursive: true })
      await appendFile(filePath, message, 'utf8')
    } catch (error) {
      console.error(
        `${COLORS.error}[ERROR] Failed to write to ${filePath}: ${error}${COLORS.reset}`
      )
    }
  }

  async flush() {
    return Promise.all([...this.fileWriteQueue])
  }
}

export const loggerPlugin = (options: LoggerOptions = {}) => {
  const defaultFormatter = (
    { request }: Pick<Context, 'request'>,
    responseTime: number,
    status: number
  ) =>
    `${new Date().toISOString()} [${request.method}] ${
      request.url
    } ${status} ${responseTime.toFixed(2)}ms`

  const {
    logLevel = 'info',
    filePath = './logs/app.log',
    scope = 'scoped',
    format = defaultFormatter,
  } = options

  return new Elysia({ name: 'Logger Plugin', seed: options })
    .state('requestStartTime', 0)
    .state('logger', new Logger({ logLevel, filePath, scope, format }))
    .onRequest(({ store }) => {
      store.requestStartTime = performance.now()
    })
    .onAfterResponse({ as: scope }, ({ request, set, store }) => {
      const responseTime =
        performance.now() - (store.requestStartTime || performance.now())
      const status = normalizeStatusCode(set.status) || 200
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      store.logger.log(level, '', { request, responseTime, status })
    })
    .onError({ as: scope }, ({ request, set, store }) => {
      const responseTime =
        performance.now() - (store.requestStartTime || performance.now())
      const status = normalizeStatusCode(set.status) || 500
      store.logger.log('error', '', { request, responseTime, status })
    })
    .onStop(({ store }) => store.logger.flush())
}

const normalizeStatusCode = (code: number | keyof StatusMap | undefined) =>
  typeof code === 'string' ? StatusMap[code] : code ?? 200
