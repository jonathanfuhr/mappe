import type { Salutation } from '@prisma/client'

/**
 * Regelbasierte Erkennung – läuft immer, auch ohne KI.
 *
 * Alles hier Gefundene ist ein **Vorschlag**. Die Oberfläche zeigt ihn an,
 * ein Klick bestätigt oder korrigiert ihn. Deshalb darf die Erkennung ruhig
 * mal danebenliegen; sie muss nur nachvollziehbar bleiben.
 */

export interface ErkannteDaten {
  anrede?: Salutation
  titel?: string
  vorname?: string
  nachname?: string
  email?: string
  telefon?: string
  strasse?: string
  plz?: string
  ort?: string
  links?: { label: string; url: string }[]
}

// --- E-Mail -----------------------------------------------------------------

const EMAIL_MUSTER = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/** Adressen von Portalen und Automaten sind nie die des Bewerbers. */
const UNBRAUCHBARE_DOMAENEN = [
  'linkedin.com',
  'indeed.com',
  'stepstone.de',
  'xing.com',
  'noreply',
  'no-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
  'bounce',
]

export function findeEmails(text: string): string[] {
  const treffer = text.match(EMAIL_MUSTER) ?? []
  const sauber = treffer
    .map((t) => t.toLowerCase().replace(/[.,;:]+$/, ''))
    .filter((t) => !UNBRAUCHBARE_DOMAENEN.some((d) => t.includes(d)))
  return [...new Set(sauber)]
}

// --- Telefon ----------------------------------------------------------------

/**
 * Deckt die üblichen deutschen Schreibweisen ab:
 *   +49 171 1234567 · 0171/1234567 · (0341) 123 45 67 · 0049 30 1234567
 *
 * Zwei getrennte Varianten mit Absicht: eine mit Landesvorwahl (danach darf
 * die Ortsvorwahl ohne führende Null stehen), eine ohne – die verlangt dann
 * zwingend eine Null oder Klammern. Ohne diese Einschränkung würde jede
 * Zahlenfolge im Lebenslauf zur Rufnummer.
 */
const TELEFON_MUSTER = new RegExp(
  [
    // Mit Landesvorwahl: +49 171 1234567 / 0049 30 1234567
    '(?:\\+|00)\\d{1,3}[\\s./-]*\\(?\\d{1,5}\\)?[\\s./-]*\\d{2,}(?:[\\s./-]*\\d{1,})*',
    // Ohne Landesvorwahl: 0171/1234567 / (0341) 123 45 67
    '(?:\\(\\s*0\\d{1,5}\\s*\\)|0\\d{1,5})[\\s./-]*\\d{2,}(?:[\\s./-]*\\d{1,})*',
  ].join('|'),
  'g',
)

export function findeTelefon(text: string): string | undefined {
  const kandidaten = text.match(TELEFON_MUSTER) ?? []
  for (const roh of kandidaten) {
    const ziffern = roh.replace(/\D/g, '')
    // Kürzer als 7 Ziffern ist keine Rufnummer, länger als 15 verstößt gegen E.164.
    if (ziffern.length < 7 || ziffern.length > 15) continue
    // Vier zusammenhängende Ziffern am Stück sind meist eine Jahreszahl.
    if (/^(19|20)\d{2}$/.test(ziffern)) continue
    return normalisiereTelefon(roh)
  }
  return undefined
}

export function normalisiereTelefon(roh: string): string {
  const getrimmt = roh.trim().replace(/\s{2,}/g, ' ')
  const ziffern = getrimmt.replace(/[^\d+]/g, '')
  if (ziffern.startsWith('00')) return '+' + ziffern.slice(2)
  if (ziffern.startsWith('+')) return ziffern
  // Führende Null durch die deutsche Landesvorwahl ersetzen – so lassen sich
  // Nummern später zuverlässig vergleichen.
  if (ziffern.startsWith('0')) return '+49' + ziffern.slice(1)
  return getrimmt
}

// --- Adresse ----------------------------------------------------------------

/** „04103 Leipzig" oder „D-04103 Leipzig" – fünfstellige PLZ plus Ortsname. */
const PLZ_ORT_MUSTER = /\b(?:D[-\s]?)?(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-/ ]{1,40}?)(?=\s*(?:$|[,;\n·|]))/gm

/** „Musterstraße 12a" – Straßenname mit Hausnummer. */
const STRASSE_MUSTER =
  /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-]{2,}(?:[\s-][A-ZÄÖÜa-zäöüß.\-]+){0,3}(?:stra(?:ß|ss)e|str\.?|weg|allee|platz|gasse|ring|damm|ufer|chaussee|pfad|steig))\s+(\d{1,4}\s?[a-zA-Z]?)\b/g

export function findeAdresse(text: string): { strasse?: string; plz?: string; ort?: string } {
  const ergebnis: { strasse?: string; plz?: string; ort?: string } = {}

  PLZ_ORT_MUSTER.lastIndex = 0
  const plzTreffer = PLZ_ORT_MUSTER.exec(text)
  if (plzTreffer) {
    ergebnis.plz = plzTreffer[1]
    ergebnis.ort = plzTreffer[2].trim().replace(/[.,;]$/, '')
  }

  STRASSE_MUSTER.lastIndex = 0
  const strasseTreffer = STRASSE_MUSTER.exec(text)
  if (strasseTreffer) {
    ergebnis.strasse = `${strasseTreffer[1].trim()} ${strasseTreffer[2].trim()}`
  }

  return ergebnis
}

// --- Links ------------------------------------------------------------------

const LINK_MUSTER = /\bhttps?:\/\/[^\s<>"')\]]+/gi

const PORTALE: { muster: RegExp; label: string }[] = [
  { muster: /linkedin\.com/i, label: 'LinkedIn' },
  { muster: /xing\.com/i, label: 'Xing' },
  { muster: /github\.com/i, label: 'GitHub' },
  { muster: /gitlab\.com/i, label: 'GitLab' },
  { muster: /behance\.net/i, label: 'Behance' },
  { muster: /dribbble\.com/i, label: 'Dribbble' },
  { muster: /vimeo\.com/i, label: 'Vimeo' },
  { muster: /youtube\.com|youtu\.be/i, label: 'YouTube' },
  { muster: /instagram\.com/i, label: 'Instagram' },
]

/** Links, die aus Signaturen und Automaten stammen, sind kein Bewerberprofil. */
const LINK_AUSSCHLUSS =
  /(unsubscribe|abmelden|datenschutz|privacy|impressum|\.png|\.jpg|\.gif|\.css|\.js$|tracking|utm_|mailto:)/i

export function findeLinks(text: string): { label: string; url: string }[] {
  const roh = text.match(LINK_MUSTER) ?? []
  const gesehen = new Set<string>()
  const ergebnis: { label: string; url: string }[] = []

  for (const eintrag of roh) {
    const url = eintrag.replace(/[.,;:]+$/, '')
    if (LINK_AUSSCHLUSS.test(url)) continue
    const schluessel = url.toLowerCase()
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)

    const portal = PORTALE.find((p) => p.muster.test(url))
    ergebnis.push({ label: portal?.label ?? kuerzeUrl(url), url })
    if (ergebnis.length >= 8) break
  }
  return ergebnis
}

function kuerzeUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

// --- Name und Anrede --------------------------------------------------------

const TITEL_MUSTER = /\b((?:Dr|Prof|Dipl|Mag|MBA|M\.Sc|B\.Sc|M\.A|B\.A)\.?(?:\s*(?:rer|nat|med|ing|oec|pol)\.?)*)\s+/i

/**
 * Zerlegt „Dr. Anna Maria von Berg" in Titel, Vorname und Nachname.
 * Namenszusätze wie „von", „van der", „de" gehören zum Nachnamen.
 */
export function zerlegeName(vollname: string): { titel?: string; vorname?: string; nachname?: string } {
  let rest = vollname.replace(/["']/g, '').trim()
  if (!rest) return {}

  // „Nachname, Vorname" – in Portalmails und Lebensläufen üblich.
  const kommaTreffer = /^([^,]+),\s*(.+)$/.exec(rest)
  if (kommaTreffer) {
    rest = `${kommaTreffer[2].trim()} ${kommaTreffer[1].trim()}`
  }

  let titel: string | undefined
  const titelTreffer = TITEL_MUSTER.exec(rest)
  if (titelTreffer) {
    titel = titelTreffer[1].replace(/\.$/, '') + '.'
    rest = rest.slice(titelTreffer.index + titelTreffer[0].length).trim()
  }

  const teile = rest.split(/\s+/).filter(Boolean)
  if (teile.length === 0) return { titel }
  if (teile.length === 1) return { titel, nachname: teile[0] }

  const zusaetze = ['von', 'van', 'de', 'der', 'den', 'del', 'di', 'da', 'zu', 'zur', 'la', 'le']
  let trenner = teile.length - 1
  for (let i = teile.length - 2; i >= 1; i--) {
    if (zusaetze.includes(teile[i].toLowerCase())) trenner = i
    else break
  }

  return {
    titel,
    vorname: teile.slice(0, trenner).join(' '),
    nachname: teile.slice(trenner).join(' '),
  }
}

/** Liest die Anrede aus dem Text – „Sehr geehrte Frau …", „Frau Dr. …". */
export function findeAnrede(text: string, vorname?: string): Salutation | undefined {
  const anfang = text.slice(0, 600)
  if (/\b(sehr geehrte frau|liebe frau|hallo frau|frau)\s+[A-ZÄÖÜ]/.test(anfang.toLowerCase())) {
    return 'FRAU'
  }
  if (/\b(sehr geehrter herr|lieber herr|hallo herr|herr)\s+[A-ZÄÖÜ]/.test(anfang.toLowerCase())) {
    return 'HERR'
  }
  // Ohne Anhaltspunkt lieber nichts raten: eine falsche Anrede in einer
  // Absage ist peinlicher als gar keine.
  void vorname
  return undefined
}

// --- Zusammenführung --------------------------------------------------------

export function erkenneAusText(
  text: string,
  absender?: { name?: string; email?: string },
): ErkannteDaten {
  const daten: ErkannteDaten = {}

  // Die Absenderadresse ist die zuverlässigste Quelle – der Bewerber hat sie
  // selbst benutzt. Erst danach greifen die Funde aus dem Text.
  const emails = findeEmails(text)
  const absenderEmail = absender?.email?.toLowerCase()
  if (absenderEmail && !UNBRAUCHBARE_DOMAENEN.some((d) => absenderEmail.includes(d))) {
    daten.email = absenderEmail
  } else if (emails[0]) {
    daten.email = emails[0]
  }

  const telefon = findeTelefon(text)
  if (telefon) daten.telefon = telefon

  const adresse = findeAdresse(text)
  Object.assign(daten, adresse)

  const links = findeLinks(text)
  if (links.length) daten.links = links

  // Name: zuerst aus dem Anzeigenamen des Absenders, sonst aus der
  // Grußformel am Ende des Anschreibens.
  const nameQuelle = absender?.name && !absender.name.includes('@') ? absender.name : findeNameAusGruss(text)
  if (nameQuelle) Object.assign(daten, zerlegeName(nameQuelle))

  // Fällt gar nichts ab, hilft manchmal noch die Adresse selbst:
  // vorname.nachname@… ist verbreitet genug, um es zu versuchen.
  if (!daten.nachname && daten.email) {
    Object.assign(daten, nameAusEmail(daten.email))
  }

  const anrede = findeAnrede(text, daten.vorname)
  if (anrede) daten.anrede = anrede

  return daten
}

/** Sucht den Namen hinter einer Grußformel am Ende des Anschreibens. */
export function findeNameAusGruss(text: string): string | undefined {
  const muster =
    /(?:mit freundlichen gr[üu][ßs]en|freundliche gr[üu][ßs]e|viele gr[üu][ßs]e|beste gr[üu][ßs]e|herzliche gr[üu][ßs]e|kind regards|best regards)[,!.]?\s*\n+\s*([^\n]{2,60})/i
  const treffer = muster.exec(text)
  if (!treffer?.[1]) return undefined

  const zeile = treffer[1].trim().replace(/[.,;:]$/, '')
  // Keine Adressen, Telefonnummern oder Titelzeilen als Name durchlassen.
  if (/@|https?:|\d{4}/.test(zeile)) return undefined
  if (zeile.split(/\s+/).length > 5) return undefined
  return zeile
}

function nameAusEmail(email: string): { vorname?: string; nachname?: string } {
  const lokal = email.split('@')[0]
  const teile = lokal.split(/[._-]/).filter((t) => t.length > 1 && !/\d/.test(t))
  if (teile.length < 2) return {}
  const gross = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  return { vorname: gross(teile[0]), nachname: gross(teile[teile.length - 1]) }
}
