import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env'
import { loadUser } from './auth/middleware'
import { authRouter } from './auth/routes'
import { errorHandler, notFound } from './lib/errors'
import { apiRouter } from './routes'
import { settingsRouter } from './settings/routes'

export function createApp(): Express {
  const app = express()

  // Hinter einem Reverse Proxy (Caddy, nginx, Cloudflared) liefert der erste
  // Hop die echte Client-IP – die braucht die Anmeldebremse.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(express.json({ limit: '5mb' }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))
  app.use(cookieParser())

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'Mappe', zeit: new Date().toISOString() })
  })

  app.use(loadUser)
  app.use('/api/auth', authRouter)
  app.use('/api/einstellungen', settingsRouter)
  app.use('/api', apiRouter)

  app.use('/api', (_req, _res, next) => next(notFound('Diesen Endpunkt gibt es nicht.')))

  // Im Container liegt das gebaute Frontend daneben und wird von hier
  // ausgeliefert; im Entwicklungsbetrieb macht das Vite.
  const webDist = path.resolve(__dirname, '../../web/dist')
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          // Der Einstiegspunkt darf nie im Cache hängen bleiben, die
          // gehashten Assets dürfen ewig liegen.
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
          else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}

export { env }
