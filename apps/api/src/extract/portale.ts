import type { ApplicationSource } from '@prisma/client'
import type { GeparsteMail } from '../mail/parse'
import { adresseAusText } from '../mail/parse'
import { normalisiereTelefon, zerlegeName, type ErkannteDaten } from './rules'

/**
 * Eigene Parser für die Benachrichtigungen der großen Portale.
 *
 * Deren Mails kommen von einer Automatenadresse und tragen den Bewerber nur
 * im Text – ohne eigenen Parser landet sonst „LinkedIn" als Bewerbername im
 * Datensatz. Die Muster sind absichtlich weich formuliert: ändert das Portal
 * sein Layout, fällt der Parser auf „nicht erkannt" zurück und die allgemeine
 * Regelerkennung übernimmt, statt Unsinn zu liefern.
 */

export interface PortalErgebnis {
  quelle: ApplicationSource
  daten: ErkannteDaten
  stelle?: string
  erkannt: boolean
}

export function erkennePortal(mail: GeparsteMail): PortalErgebnis | null {
  const absender = mail.von.email.toLowerCase()
  const text = mail.textInhalt

  if (absender.includes('linkedin.com')) return parseLinkedIn(text, mail.betreff)
  if (absender.includes('indeed.com')) return parseIndeed(text, mail.betreff)
  return null
}

function parseLinkedIn(text: string, betreff: string): PortalErgebnis {
  const daten: ErkannteDaten = {}

  // „Neue Bewerbung von Max Mustermann" / „New application from …"
  const nameTreffer =
    /(?:neue bewerbung von|new application(?: received)? from|bewerbung von)\s+([^\n,–|]{2,60})/i.exec(text) ??
    /(?:neue bewerbung von|new application from)\s+([^\n,–|]{2,60})/i.exec(betreff)
  if (nameTreffer?.[1]) Object.assign(daten, zerlegeName(nameTreffer[1].trim()))

  const kontakt = findeKontakt(text)
  Object.assign(daten, kontakt)

  // „… für die Stelle Mediengestalter" / „… for Mediengestalter at Firma"
  const stelleTreffer =
    /(?:für (?:die|Ihre) (?:Stelle|Position)|für)\s+([^\n|]{3,80}?)(?:\s+bei\s|\s*$|\n)/i.exec(betreff) ??
    /\bfor\s+([^\n|]{3,80}?)(?:\s+at\s|\s*$|\n)/i.exec(betreff)

  return {
    quelle: 'LINKEDIN',
    daten,
    stelle: stelleTreffer?.[1]?.trim(),
    erkannt: Boolean(daten.nachname || daten.email),
  }
}

function parseIndeed(text: string, betreff: string): PortalErgebnis {
  const daten: ErkannteDaten = {}

  // Indeed setzt den Bewerbernamen meist in den Betreff:
  // „Max Mustermann hat sich auf Mediengestalter beworben"
  const betreffTreffer =
    /^([^\n]{2,60}?)\s+(?:hat sich(?: auf| für)|applied)/i.exec(betreff) ??
    /(?:Bewerbung von|Application from)\s+([^\n,|]{2,60})/i.exec(betreff)
  if (betreffTreffer?.[1]) Object.assign(daten, zerlegeName(betreffTreffer[1].trim()))

  if (!daten.nachname) {
    const imText = /(?:Name|Bewerber(?:in)?)\s*[:：]\s*([^\n]{2,60})/i.exec(text)
    if (imText?.[1]) Object.assign(daten, zerlegeName(imText[1].trim()))
  }

  Object.assign(daten, findeKontakt(text))

  const stelleTreffer =
    /(?:auf|für)\s+(?:die Stelle\s+)?["„]?([^\n"“|]{3,80}?)["“]?\s*(?:beworben|$)/i.exec(betreff) ??
    /(?:Stelle|Position)\s*[:：]\s*([^\n]{3,80})/i.exec(text)

  return {
    quelle: 'INDEED',
    daten,
    stelle: stelleTreffer?.[1]?.trim(),
    erkannt: Boolean(daten.nachname || daten.email),
  }
}

/** Kontaktzeilen, wie beide Portale sie im Fließtext mitschicken. */
function findeKontakt(text: string): Pick<ErkannteDaten, 'email' | 'telefon'> {
  const ergebnis: Pick<ErkannteDaten, 'email' | 'telefon'> = {}

  const emailZeile = /(?:E-?Mail|Email|Kontakt)\s*[:：]\s*([^\n]{5,120})/i.exec(text)
  const adresse = emailZeile ? adresseAusText(emailZeile[1]) : null
  // Die Portaldomäne selbst ist nie die Adresse des Bewerbers.
  if (adresse && !/linkedin\.com|indeed\.com/i.test(adresse.email)) ergebnis.email = adresse.email

  const telefonZeile = /(?:Telefon|Tel\.?|Phone|Mobil)\s*[:：]\s*([+\d][\d\s()./-]{6,25})/i.exec(text)
  if (telefonZeile?.[1]) ergebnis.telefon = normalisiereTelefon(telefonZeile[1])

  return ergebnis
}
