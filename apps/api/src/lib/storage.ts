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
    try {
      await fs.mkdir(path.join(env.storageDir, bucket), { recursive: true })
    } catch (err) {
      // Der mit Abstand häufigste Startfehler, sobald die Ablage auf ein
      // Verzeichnis des Servers zeigt statt in ein Docker-Volume: Das
      // Verzeichnis gehört root, der Container läuft als `node`. Die nackte
      // Meldung „EACCES: permission denied, mkdir" sagt niemandem, was zu tun
      // ist – also sagen wir es.
      if ((err as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(
          `Die Ablage „${env.storageDir}" ist nicht beschreibbar.\n` +
            'Mappe läuft im Container als Benutzer 1000. Zeigt DOKUMENTE_DIR auf ein ' +
            'Verzeichnis des Servers, muss dieses ihm gehören:\n\n' +
            '  chown -R 1000:1000 <das Verzeichnis aus DOKUMENTE_DIR>\n',
        )
      }
      throw err
    }
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

/**
 * Baut den vollständigen `Content-Disposition`-Wert.
 *
 * HTTP-Kopfzeilen dürfen nur Latin-1 enthalten. Node setzt das durch und
 * bricht sonst mit ERR_INVALID_CHAR ab – die Antwort scheitert dann komplett,
 * die Datei ist im Browser einfach nicht da.
 *
 * Aufgefallen ist das an den aufgetrennten PDFs: Sie heißen „Bewerbung –
 * Anschreiben 1.pdf", und der Gedankenstrich (U+2013) liegt außerhalb von
 * Latin-1. Die hochgeladenen Originale gingen weiter, weil ihre Namen aus dem
 * Mailanhang stammen und selten Sonderzeichen enthalten – das machte den
 * Fehler erst schwer greifbar.
 *
 * Deshalb beides, wie es RFC 6266 vorsieht: ein zahmer ASCII-Name für alte
 * Programme und `filename*` mit dem echten Namen für alle heutigen Browser.
 */
export function contentDisposition(inline: boolean, name: string): string {
  const bereinigt = downloadName(name)

  // Für den ASCII-Teil: Was sich sinnvoll ersetzen lässt, wird ersetzt – der
  // Rest weicht einem Bindestrich, damit der Name lesbar bleibt.
  const ascii =
    bereinigt
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(/[^\x20-\x7E]/g, '-')
      .trim() || 'datei'

  const kodiert = encodeURIComponent(bereinigt)

  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${kodiert}`
}
