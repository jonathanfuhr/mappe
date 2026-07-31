import { createApp } from './app'
import { env } from './env'
import { prisma } from './db'
import { ensureStorage } from './lib/storage'

async function main(): Promise<void> {
  await ensureStorage()
  await prisma.$connect()

  const app = createApp()
  const server = app.listen(env.port, () => {
    console.log(`[mappe] Läuft auf Port ${env.port} (${env.isProd ? 'Betrieb' : 'Entwicklung'})`)
    console.log(`[mappe] Ablage: ${env.storageDir}`)
  })

  const shutdown = (signal: string): void => {
    console.log(`[mappe] ${signal} empfangen – fahre herunter.`)
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0))
    })
    // Notbremse, falls eine Verbindung hängt.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[mappe] Start fehlgeschlagen:', err)
  process.exit(1)
})
