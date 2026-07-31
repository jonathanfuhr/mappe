import type { ErkannteDaten } from './rules'
import { normalisiereTelefon, zerlegeName } from './rules'

/**
 * Parser für Mails aus dem Website-Formular.
 *
 * Solche Mails haben ein festes Format – Feldname, Doppelpunkt, Wert. Das
 * lässt sich sehr zuverlässig auslesen, ganz ohne KI. Die Feldnamen sind
 * bewusst großzügig gefasst, damit ein umbenanntes Formularfeld den Parser
 * nicht sofort blind macht.
 */

const FELD_ZUORDNUNG: { schluessel: keyof ErkannteDaten | 'vollname' | 'stelle' | 'nachricht'; namen: string[] }[] =
  [
    { schluessel: 'vollname', namen: ['name', 'vollständiger name', 'vollstaendiger name', 'ihr name', 'full name'] },
    { schluessel: 'vorname', namen: ['vorname', 'first name', 'firstname'] },
    { schluessel: 'nachname', namen: ['nachname', 'name (nachname)', 'familienname', 'last name', 'lastname', 'surname'] },
    { schluessel: 'email', namen: ['e-mail', 'email', 'mail', 'e-mail-adresse', 'emailadresse', 'e-mail adresse'] },
    { schluessel: 'telefon', namen: ['telefon', 'telefonnummer', 'tel', 'handy', 'mobil', 'phone', 'rufnummer'] },
    { schluessel: 'strasse', namen: ['straße', 'strasse', 'anschrift', 'adresse', 'street'] },
    { schluessel: 'plz', namen: ['plz', 'postleitzahl', 'zip', 'postcode'] },
    { schluessel: 'ort', namen: ['ort', 'stadt', 'wohnort', 'city'] },
    { schluessel: 'stelle', namen: ['stelle', 'position', 'stellenangebot', 'stellenanzeige', 'bewerbung als', 'job', 'gewünschte stelle'] },
    { schluessel: 'nachricht', namen: ['nachricht', 'mitteilung', 'anschreiben', 'ihre nachricht', 'message', 'kommentar'] },
  ]

export interface FormularErgebnis {
  /** Nur true, wenn das Muster wirklich passt – sonst greift die Heuristik. */
  erkannt: boolean
  daten: ErkannteDaten
  stelle?: string
  nachricht?: string
  /** Wie viele Felder zugeordnet werden konnten – Maß für die Verlässlichkeit. */
  trefferAnzahl: number
}

export function parseFormularMail(text: string): FormularErgebnis {
  const zeilen = text.split(/\r?\n/)
  const felder = new Map<string, string>()

  let aktuellesFeld: string | null = null

  for (const zeile of zeilen) {
    // Mehrzeilige Werte (typisch beim Nachrichtenfeld) an das zuletzt
    // erkannte Feld anhängen, statt sie zu verlieren.
    const treffer = /^\s*\*?\s*([A-Za-zÄÖÜäöüß .()/-]{2,40}?)\s*\*?\s*[:：]\s*(.*)$/.exec(zeile)
    if (treffer) {
      aktuellesFeld = treffer[1].trim().toLowerCase().replace(/\s+/g, ' ')
      felder.set(aktuellesFeld, treffer[2].trim())
      continue
    }
    if (aktuellesFeld && zeile.trim()) {
      felder.set(aktuellesFeld, `${felder.get(aktuellesFeld) ?? ''}\n${zeile.trim()}`.trim())
    }
  }

  const daten: ErkannteDaten = {}
  let stelle: string | undefined
  let nachricht: string | undefined
  let treffer = 0

  for (const [feldName, wert] of felder) {
    if (!wert) continue
    const zuordnung = FELD_ZUORDNUNG.find((z) => z.namen.includes(feldName))
    if (!zuordnung) continue
    treffer++

    switch (zuordnung.schluessel) {
      case 'vollname':
        Object.assign(daten, zerlegeName(wert))
        break
      case 'stelle':
        stelle = wert
        break
      case 'nachricht':
        nachricht = wert
        break
      case 'telefon':
        daten.telefon = normalisiereTelefon(wert)
        break
      case 'email':
        daten.email = wert.toLowerCase().trim()
        break
      default:
        // Restliche Felder gehen unverändert durch.
        ;(daten as Record<string, unknown>)[zuordnung.schluessel] = wert
    }
  }

  // Zwei zugeordnete Felder sind zu wenig für eine sichere Aussage – dann
  // war es vermutlich ein normales Anschreiben mit Doppelpunkten darin.
  return {
    erkannt: treffer >= 3 && Boolean(daten.email || daten.nachname),
    daten,
    stelle,
    nachricht,
    trefferAnzahl: treffer,
  }
}
