import crypto from 'node:crypto'
import { env } from '../env'

/**
 * Zugangsdaten (Mail-Secrets, KI-API-Keys) liegen verschlüsselt in der
 * Datenbank. AES-256-GCM, Schlüssel aus ENCRYPTION_KEY abgeleitet.
 *
 * Format: mappe1:<iv-base64>:<authTag-base64>:<ciphertext-base64>
 */

const PREFIX = 'mappe1'

function key(): Buffer {
  // ENCRYPTION_KEY darf Hex oder beliebiger Text sein – SHA-256 macht daraus
  // in jedem Fall 32 saubere Bytes.
  return crypto.createHash('sha256').update(env.encryptionKey, 'utf8').digest()
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX + ':')) {
    // Wert wurde vor der Verschlüsselung angelegt oder von Hand gesetzt.
    return value
  }
  const [, ivB64, tagB64, dataB64] = value.split(':')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Verschlüsselter Wert ist beschädigt.')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
    'utf8',
  )
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX + ':')
}

/** Für die Oberfläche: nie das Geheimnis, nur die Information "ist gesetzt". */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  return '••••••••'
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
