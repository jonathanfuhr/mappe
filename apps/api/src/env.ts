import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Lädt eine .env, falls vorhanden. Im Container kommt die Konfiguration über
 * echte Umgebungsvariablen, lokal aus der Datei – bereits gesetzte Werte haben
 * immer Vorrang. Node bringt loadEnvFile ab 20.6 selbst mit, deshalb braucht
 * es dafür kein Paket.
 */
function loadDotEnv(): void {
  const candidates = [
    process.env.ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../../.env'),
  ].filter((p): p is string => Boolean(p))

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
    break
  }
}

loadDotEnv()

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

  port: Number(process.env.PORT ?? (isProd ? 3000 : 3001)),
  databaseUrl: required('DATABASE_URL', isTest ? 'postgresql://localhost/mappe_test' : undefined),

  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
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
