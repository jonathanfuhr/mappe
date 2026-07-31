import de from './de.json'

/**
 * Bewusst winzig gehalten: ein Wörterbuch, verschachtelte Schlüssel und
 * Platzhalter der Form {name}. Kommt später Englisch dazu, wird hier nur eine
 * zweite JSON-Datei eingehängt – kein Code in den Komponenten ändert sich.
 */

export type Sprache = 'de'

const woerterbuecher: Record<Sprache, unknown> = { de }

let aktuelleSprache: Sprache = 'de'

export function setzeSprache(sprache: Sprache): void {
  aktuelleSprache = sprache
}

function schlage(pfad: string, quelle: unknown): string | undefined {
  const wert = pfad.split('.').reduce<unknown>((acc, teil) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[teil]
    return undefined
  }, quelle)
  return typeof wert === 'string' ? wert : undefined
}

export function t(pfad: string, werte?: Record<string, string | number>): string {
  const text = schlage(pfad, woerterbuecher[aktuelleSprache])
  if (text === undefined) {
    // Fehlender Schlüssel darf die Oberfläche nicht sprengen – der Pfad selbst
    // ist als Notbehelf immer noch lesbar und fällt beim Testen sofort auf.
    if (import.meta.env.DEV) console.warn(`[i18n] Kein Text für "${pfad}"`)
    return pfad
  }
  if (!werte) return text
  return text.replace(/\{(\w+)\}/g, (treffer, schluessel: string) =>
    schluessel in werte ? String(werte[schluessel]) : treffer,
  )
}

// --- Formatierung -----------------------------------------------------------

const datumFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
const datumZeitFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

export function formatDatum(wert: string | Date | null | undefined): string {
  if (!wert) return '–'
  const d = typeof wert === 'string' ? new Date(wert) : wert
  return Number.isNaN(d.getTime()) ? '–' : datumFormat.format(d)
}

export function formatDatumZeit(wert: string | Date | null | undefined): string {
  if (!wert) return '–'
  const d = typeof wert === 'string' ? new Date(wert) : wert
  return Number.isNaN(d.getTime()) ? '–' : datumZeitFormat.format(d)
}

/** "vor 3 Tagen", "gerade eben" – für Listen angenehmer als ein Datum. */
export function formatRelativ(wert: string | Date | null | undefined): string {
  if (!wert) return '–'
  const d = typeof wert === 'string' ? new Date(wert) : wert
  if (Number.isNaN(d.getTime())) return '–'

  const sekunden = Math.round((Date.now() - d.getTime()) / 1000)
  if (sekunden < 60) return 'gerade eben'

  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })
  const stufen: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ]
  let passend: [Intl.RelativeTimeFormatUnit, number] = stufen[0]
  for (const stufe of stufen) {
    if (sekunden >= stufe[1]) passend = stufe
  }
  return rtf.format(-Math.round(sekunden / passend[1]), passend[0])
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const einheiten = ['KB', 'MB', 'GB']
  let wert = bytes / 1024
  let i = 0
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024
    i++
  }
  return `${wert.toFixed(wert < 10 ? 1 : 0)} ${einheiten[i]}`
}
