import { Elysia } from 'elysia'
import { Logger, loggerPlugin } from 'logger.plugin.js'

export const AppLogger = new Logger({ filePath: './logs/app.log' })

const app = new Elysia()
  .use(
    loggerPlugin({
      logLevel: 'info',
      filePath: './logs/app.log',
      scope: 'global',
    })
  )
  .get('/', ({ status }) => status(200, { message: 'hello from elysia' }))
  .listen(3001)

AppLogger.log('info', 'App started')
