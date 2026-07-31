import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../env'

/**
 * Alle Dateien liegen unterhalb von STORAGE_DIR, sortiert nach Zweck und
 * Jahr/Monat. Der Dateiname wird immer neu vergeben – der Name aus der Mail
 * landet nur in der Datenbank, nie im Dateisystem. Das schließt aus, dass ein
 * präparierter Anhang aus dem Verzeichnis ausbricht.
 */

export type StorageBucket = 'dokumente' | 'anhaenge' | 'mails' | 'temp'

export async function ensureStorage(): Promise<void> {
  for (const bucket of ['dokumente', 'anhaenge', 'mails', 'temp'] as const) {
    await fs.mkdir(path.join(env.storageDir, bucket), { recursive: true })
  }
}

function monthFolder(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Behält nur eine harmlose Endung aus dem Originalnamen. */
export function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

/** Erzeugt einen relativen Ablagepfad und legt den Ordner an. */
export async function allocatePath(bucket: StorageBucket, originalName: string): Promise<string> {
  const rel = path.join(bucket, monthFolder(), crypto.randomUUID() + safeExtension(originalName))
  await fs.mkdir(path.dirname(path.join(env.storageDir, rel)), { recursive: true })
  return rel
}

export function absolutePath(relative: string): string {
  const abs = path.resolve(env.storageDir, relative)
  // Riegel gegen ../-Pfade aus alten oder manipulierten Datensätzen.
  if (abs !== env.storageDir && !abs.startsWith(env.storageDir + path.sep)) {
    throw new Error(`Pfad liegt außerhalb der Ablage: ${relative}`)
  }
  return abs
}

export async function writeFileTo(
  bucket: StorageBucket,
  originalName: string,
  data: Buffer,
): Promise<{ storagePath: string; size: number }> {
  const rel = await allocatePath(bucket, originalName)
  await fs.writeFile(absolutePath(rel), data)
  return { storagePath: rel, size: data.byteLength }
}

export async function readFileFrom(relative: string): Promise<Buffer> {
  return fs.readFile(absolutePath(relative))
}

export async function deleteFile(relative: string): Promise<void> {
  try {
    await fs.unlink(absolutePath(relative))
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    // Datei schon weg? Dann ist das Ziel bereits erreicht.
    if (e.code !== 'ENOENT') throw err
  }
}

export async function fileExists(relative: string): Promise<boolean> {
  try {
    await fs.access(absolutePath(relative))
    return true
  } catch {
    return false
  }
}

/** Bereinigt einen Dateinamen für den Download-Header. */
export function downloadName(name: string): string {
  return (
    name
      .replace(/[\r\n"\\]/g, '')
      .replace(/[/\\]/g, '-')
      .trim()
      .slice(0, 180) || 'datei'
  )
}
