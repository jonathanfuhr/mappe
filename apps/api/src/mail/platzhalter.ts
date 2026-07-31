import type { Application, Candidate, CustomField, CustomFieldValue, Job, Salutation } from '@prisma/client'

/**
 * Platzhalter in Mail-Vorlagen.
 *
 * Schreibweise: $VORNAME oder ${VORNAME}. Die geschweifte Form braucht man,
 * wenn direkt ein Buchstabe folgt („${VORNAME}s Unterlagen").
 *
 * Grundregel: Ein Platzhalter, für den es keinen Wert gibt, wird zu einem
 * leeren String – aber die Vorschau meldet ihn. Lieber eine Lücke, die vor
 * dem Senden auffällt, als ein „$VORNAME" in der Mail an den Bewerber.
 */

export interface PlatzhalterQuelle {
  bewerbung: Application & {
    candidate: Candidate & { fieldValues?: (CustomFieldValue & { field: CustomField })[] }
    job: Job | null
    fieldValues?: (CustomFieldValue & { field: CustomField })[]
  }
  organisation: string
  absenderName: string
  bearbeiterName: string
}

export interface PlatzhalterBeschreibung {
  name: string
  beschreibung: string
  beispiel: string
}

/** Für die Hilfe in der Vorlagen-Verwaltung. */
export const STANDARD_PLATZHALTER: PlatzhalterBeschreibung[] = [
  { name: 'ANREDE', beschreibung: 'Frau / Herr (leer, wenn unbekannt)', beispiel: 'Frau' },
  {
    name: 'ANREDE_FORMELL',
    beschreibung: 'Vollständige Briefanrede, fällt ohne Namen auf „Sehr geehrte Damen und Herren" zurück',
    beispiel: 'Sehr geehrte Frau Wendler',
  },
  { name: 'ANREDE_DU', beschreibung: 'Lockere Anrede mit Vornamen', beispiel: 'Hallo Sarah' },
  { name: 'VORNAME', beschreibung: 'Vorname des Bewerbers', beispiel: 'Sarah' },
  { name: 'NACHNAME', beschreibung: 'Nachname des Bewerbers', beispiel: 'Wendler' },
  { name: 'TITEL', beschreibung: 'Akademischer Titel', beispiel: 'Dr.' },
  { name: 'NAME', beschreibung: 'Vor- und Nachname', beispiel: 'Sarah Wendler' },
  { name: 'EMAIL', beschreibung: 'E-Mail-Adresse des Bewerbers', beispiel: 'sarah@example.com' },
  { name: 'TELEFON', beschreibung: 'Telefonnummer des Bewerbers', beispiel: '+491711234567' },
  { name: 'STELLE', beschreibung: 'Titel der Stelle', beispiel: 'Mediengestalter (m/w/d)' },
  { name: 'STELLE_REFERENZ', beschreibung: 'Referenznummer der Stelle', beispiel: 'MG-2025-04' },
  { name: 'STELLE_ORT', beschreibung: 'Ort der Stelle', beispiel: 'Leipzig' },
  { name: 'EINGANGSDATUM', beschreibung: 'Datum des Bewerbungseingangs', beispiel: '14.07.2025' },
  { name: 'DATUM', beschreibung: 'Heutiges Datum', beispiel: '31.07.2026' },
  { name: 'ORGANISATION', beschreibung: 'Name der Organisation', beispiel: 'Muster GmbH' },
  { name: 'BEARBEITER', beschreibung: 'Name des angemeldeten Nutzers', beispiel: 'Jonathan Fuhr' },
]

const datumFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' })

export function baueWerte(quelle: PlatzhalterQuelle): Record<string, string> {
  const { bewerbung, organisation, absenderName, bearbeiterName } = quelle
  const b = bewerbung.candidate
  const anrede = anredeWort(b.salutation)

  const werte: Record<string, string> = {
    ANREDE: anrede,
    ANREDE_FORMELL: formelleAnrede(b.salutation, b.lastName, b.title),
    ANREDE_DU: b.firstName ? `Hallo ${b.firstName}` : 'Hallo',
    VORNAME: b.firstName ?? '',
    NACHNAME: b.lastName ?? '',
    TITEL: b.title ?? '',
    NAME: [b.firstName, b.lastName].filter(Boolean).join(' '),
    EMAIL: b.email ?? '',
    TELEFON: b.phone ?? '',
    STELLE: bewerbung.job?.title ?? (bewerbung.speculative ? 'Initiativbewerbung' : ''),
    STELLE_REFERENZ: bewerbung.job?.reference ?? '',
    STELLE_ORT: bewerbung.job?.location ?? '',
    EINGANGSDATUM: datumFormat.format(bewerbung.appliedAt),
    DATUM: datumFormat.format(new Date()),
    ORGANISATION: organisation,
    ABSENDER: absenderName || organisation,
    BEARBEITER: bearbeiterName,
  }

  // Freifelder – erst die der Person, dann die der Bewerbung. Bei gleichem
  // Schlüssel gewinnt die Bewerbung, weil sie der engere Zusammenhang ist.
  for (const eintrag of bewerbung.candidate.fieldValues ?? []) {
    werte[eintrag.field.key.toUpperCase()] = eintrag.value
  }
  for (const eintrag of bewerbung.fieldValues ?? []) {
    werte[eintrag.field.key.toUpperCase()] = eintrag.value
  }

  return werte
}

export interface EinsetzErgebnis {
  text: string
  /** Platzhalter, für die kein Wert vorlag – die Oberfläche warnt davor. */
  fehlende: string[]
  /** Namen, die es gar nicht gibt – meist ein Tippfehler in der Vorlage. */
  unbekannte: string[]
}

const PLATZHALTER_MUSTER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Z][A-Z0-9_]*)/g

export function setzeEin(vorlage: string, werte: Record<string, string>): EinsetzErgebnis {
  const fehlende = new Set<string>()
  const unbekannte = new Set<string>()

  const text = vorlage.replace(PLATZHALTER_MUSTER, (treffer, geklammert?: string, einfach?: string) => {
    const name = (geklammert ?? einfach ?? '').toUpperCase()
    if (!(name in werte)) {
      unbekannte.add(name)
      // Unbekannte Platzhalter stehen lassen: So fällt der Tippfehler in der
      // Vorschau sofort auf, statt still zu verschwinden.
      return treffer
    }
    const wert = werte[name]
    if (!wert) fehlende.add(name)
    return wert
  })

  return { text, fehlende: [...fehlende], unbekannte: [...unbekannte] }
}

/**
 * Räumt die Lücken auf, die leere Platzhalter hinterlassen: doppelte
 * Leerzeichen, ein Leerzeichen vor dem Komma, mehr als eine Leerzeile.
 */
export function glaetteText(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

function anredeWort(anrede: Salutation): string {
  if (anrede === 'FRAU') return 'Frau'
  if (anrede === 'HERR') return 'Herr'
  return ''
}

/**
 * Die formelle Anrede ist der heikelste Platzhalter: Eine falsch geratene
 * Anrede in einer Absage ist ein echter Fehlgriff. Ohne bekannte Anrede oder
 * ohne Nachnamen wird deshalb bewusst die neutrale Form verwendet.
 */
export function formelleAnrede(anrede: Salutation, nachname: string, titel?: string | null): string {
  const name = [titel, nachname].filter(Boolean).join(' ').trim()
  if (!name) return 'Sehr geehrte Damen und Herren'
  if (anrede === 'FRAU') return `Sehr geehrte Frau ${name}`
  if (anrede === 'HERR') return `Sehr geehrter Herr ${name}`
  return 'Sehr geehrte Damen und Herren'
}

/** Setzt Vorlagentext ein und glättet ihn in einem Schritt. */
export function rendereVorlage(
  vorlage: { subject: string; body: string },
  werte: Record<string, string>,
  signatur?: string,
): { betreff: string; text: string; fehlende: string[]; unbekannte: string[] } {
  const betreffErgebnis = setzeEin(vorlage.subject, werte)
  const koerper = signatur ? `${vorlage.body}\n\n${signatur}` : vorlage.body
  const textErgebnis = setzeEin(koerper, werte)

  return {
    betreff: glaetteText(betreffErgebnis.text).replace(/\n+/g, ' '),
    text: glaetteText(textErgebnis.text),
    fehlende: [...new Set([...betreffErgebnis.fehlende, ...textErgebnis.fehlende])],
    unbekannte: [...new Set([...betreffErgebnis.unbekannte, ...textErgebnis.unbekannte])],
  }
}
