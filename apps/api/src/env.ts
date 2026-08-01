import crypto from 'node:crypto'
import path from 'node:path'
import { ladeDotEnv } from './lib/dotenv'

ladeDotEnv()

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '') {
    throw new Error(
      `Umgebungsvariable ${name} fehlt. Siehe .env.example – die Datei erklärt jeden Wert.`,
    )
  }
  return value
}

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

/**
 * In Entwicklung und Test darf ein Zufallswert einspringen, damit niemand vor
 * dem ersten Start eine .env bauen muss. Im Betrieb wird der Wert erzwungen –
 * ein wechselndes Geheimnis würde dort alle Sitzungen bei jedem Neustart
 * entwerten und, schlimmer, alle verschlüsselten Zugangsdaten unlesbar machen.
 */
function secret(name: string): string {
  const value = process.env[name]
  if (value && value.length >= 16) return value
  if (isProd) {
    throw new Error(
      `${name} fehlt oder ist zu kurz (mindestens 16 Zeichen). ` +
        `Erzeugen mit:  openssl rand -hex 32`,
    )
  }
  return crypto.randomBytes(32).toString('hex')
}

export const env = {
  isProd,
  isTest,
  isDev: !isProd && !isTest,

  /*
   * Der Port, auf dem dieser Prozess lauscht – nicht zu verwechseln mit
   * MAPPE_PORT aus der .env. Im Container ist er fest auf 3000 gesetzt und
   * wird nach außen auf MAPPE_PORT abgebildet; in der Entwicklung liegt die
   * API auf 4301 und Vite auf 4300, sodass die Adresse im Browser in beiden
   * Fällen dieselbe ist.
   */
  port: Number(process.env.PORT ?? (isProd ? 3000 : 4301)),
  databaseUrl: required('DATABASE_URL', isTest ? 'postgresql://localhost/mappe_test' : undefined),

  appUrl: (process.env.APP_URL ?? 'http://localhost:4300').replace(/\/+$/, ''),
  sessionSecret: secret('SESSION_SECRET'),
  encryptionKey: secret('ENCRYPTION_KEY'),

  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage')),

  /** Wie lange eine Anmeldung gilt. */
  sessionMaxAgeMs: 1000 * 60 * 60 * 24 * 14,

  /** Taktung des Mail-Abrufs in Sekunden. 0 schaltet den Hintergrundlauf ab. */
  mailPollSeconds: Number(process.env.MAIL_POLL_SECONDS ?? 120),

  /** Taktung der Fristenprüfung in Sekunden (Standard: alle 6 Stunden). */
  retentionIntervalSeconds: Number(process.env.RETENTION_INTERVAL_SECONDS ?? 6 * 60 * 60),

  /** Obergrenze je Datei-Upload. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024),
}

export type Env = typeof env
