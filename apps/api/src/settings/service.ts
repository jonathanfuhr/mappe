import { prisma } from '../db'
import { decryptSecret, encryptSecret, isEncrypted } from '../lib/crypto'
import {
  SECRET_PATHS,
  Settings,
  SettingsKey,
  settingsSchemas,
} from './schema'

type Plain = Record<string, unknown>

function getPath(obj: Plain, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Plain)[part]
    return undefined
  }, obj)
}

function setPath(obj: Plain, path: string, value: unknown): void {
  const parts = path.split('.')
  const last = parts.pop()!
  let cursor: Plain = obj
  for (const part of parts) {
    if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {}
    cursor = cursor[part] as Plain
  }
  cursor[last] = value
}

/** Merkt sich gelesene Einstellungen kurz, damit der Mail-Lauf die DB nicht flutet. */
const cache = new Map<SettingsKey, { value: unknown; until: number }>()
const CACHE_MS = 5000

export function clearSettingsCache(): void {
  cache.clear()
}

/** Liest einen Bereich inklusive entschlüsselter Geheimnisse (nur serverintern!). */
export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings[K]> {
  const hit = cache.get(key)
  if (hit && hit.until > Date.now()) return hit.value as Settings[K]

  const row = await prisma.setting.findUnique({ where: { key } })
  const raw = (row?.value ?? {}) as Plain

  // Vor dem Parsen entschlüsseln, damit das Schema den Klartext sieht.
  const decrypted: Plain = structuredClone(raw)
  for (const path of SECRET_PATHS[key]) {
    const value = getPath(decrypted, path)
    if (typeof value === 'string' && value !== '') {
      try {
        setPath(decrypted, path, decryptSecret(value))
      } catch {
        // Falscher ENCRYPTION_KEY: lieber leer als Müll – der Admin muss den
        // Wert dann neu hinterlegen.
        setPath(decrypted, path, '')
      }
    }
  }

  const parsed = settingsSchemas[key].parse(decrypted) as Settings[K]
  cache.set(key, { value: parsed, until: Date.now() + CACHE_MS })
  return parsed
}

export async function getSettings(): Promise<Settings> {
  const [allgemein, mail, ki, fristen, anmeldung] = await Promise.all([
    getSetting('allgemein'),
    getSetting('mail'),
    getSetting('ki'),
    getSetting('fristen'),
    getSetting('anmeldung'),
  ])
  return { allgemein, mail, ki, fristen, anmeldung }
}

/**
 * Schreibt einen Bereich. Ein Geheimnis, das als leerer String kommt, bleibt
 * unverändert – so kann die Oberfläche das Formular abschicken, ohne das
 * Geheimnis je gesehen zu haben.
 */
export async function updateSetting<K extends SettingsKey>(
  key: K,
  patch: Plain,
): Promise<Settings[K]> {
  const current = await getSetting(key)
  const merged = deepMerge(structuredClone(current as unknown as Plain), patch)

  for (const path of SECRET_PATHS[key]) {
    const incoming = getPath(patch, path)
    if (incoming === undefined || incoming === '') {
      // Nicht mitgeschickt oder bewusst leer gelassen -> alten Wert behalten.
      setPath(merged, path, getPath(current as unknown as Plain, path) ?? '')
    }
  }

  const parsed = settingsSchemas[key].parse(merged) as Settings[K]

  // Für die Ablage wieder verschlüsseln.
  const toStore = structuredClone(parsed as unknown as Plain)
  for (const path of SECRET_PATHS[key]) {
    const value = getPath(toStore, path)
    if (typeof value === 'string' && value !== '' && !isEncrypted(value)) {
      setPath(toStore, path, encryptSecret(value))
    }
  }

  await prisma.setting.upsert({
    where: { key },
    create: { key, value: toStore as object },
    update: { value: toStore as object },
  })
  cache.delete(key)
  return parsed
}

/** Fassung für die Oberfläche: Geheimnisse werden durch ein Kennzeichen ersetzt. */
export async function getSettingForUi<K extends SettingsKey>(
  key: K,
): Promise<Settings[K] & { _gesetzt: Record<string, boolean> }> {
  const value = await getSetting(key)
  const copy = structuredClone(value as unknown as Plain)
  const gesetzt: Record<string, boolean> = {}
  for (const path of SECRET_PATHS[key]) {
    const raw = getPath(copy, path)
    gesetzt[path] = typeof raw === 'string' && raw !== ''
    setPath(copy, path, '')
  }
  return { ...(copy as Settings[K]), _gesetzt: gesetzt }
}

function deepMerge(target: Plain, source: Plain): Plain {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const existing = target[k]
      target[k] = deepMerge(
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Plain)
          : {},
        v as Plain,
      )
    } else if (v !== undefined) {
      target[k] = v
    }
  }
  return target
}
