import type { ApplicationSource, Prisma } from '@prisma/client'
import { analysiereBewerbung } from '../ai/analyse'
import { prisma } from '../db'
import { erkennePortal } from '../extract/portale'
import { parseFormularMail } from '../extract/formular'
import { erkenneAusText, type ErkannteDaten } from '../extract/rules'
import { ordneStelleZu } from '../extract/stellen'
import { audit } from '../lib/audit'
import { writeFileTo } from '../lib/storage'
import { ereignis } from '../lib/historie'
import { extrahiereText, istPdf } from '../pdf/text'
import type { Settings } from '../settings/schema'
import { getSetting } from '../settings/service'
import { bildeVerlaufsKennung, parseMime, type GeparsteMail } from './parse'
import type { Bereich, MailAdapter, RohMail } from './types'

export interface ImportBericht {
  gepruefte: number
  neueBewerbungen: number
  angehaengteAntworten: number
  uebersprungen: number
  fehler: { nachricht: string; grund: string }[]
}

/**
 * Nimmt rohe Nachrichten entgegen und macht daraus Bewerbungen.
 *
 * Reihenfolge mit Absicht: erst wird alles unverändert gesichert (.eml,
 * Anhänge), dann erst gedeutet. Geht die Erkennung schief, liegen die Daten
 * trotzdem vollständig im Tool und lassen sich von Hand nacharbeiten.
 */
export async function importiereMails(
  rohMails: RohMail[],
  einstellungen: Settings['mail'],
  adapter?: MailAdapter,
  bereich: Bereich = 'posteingang',
): Promise<ImportBericht> {
  const bericht: ImportBericht = {
    gepruefte: rohMails.length,
    neueBewerbungen: 0,
    angehaengteAntworten: 0,
    uebersprungen: 0,
    fehler: [],
  }

  const stellen = await prisma.job.findMany({ where: { status: { not: 'ENTWURF' } } })

  for (const roh of rohMails) {
    try {
      const ergebnis = await importiereEine(roh, einstellungen, stellen, bereich)
      if (ergebnis === 'neu') bericht.neueBewerbungen++
      else if (ergebnis === 'antwort') bericht.angehaengteAntworten++
      else bericht.uebersprungen++

      // Abhol-Regeln erst nach erfolgreichem Import anwenden – sonst wäre
      // eine Nachricht bei einem Fehler weggeräumt, ohne im Tool zu sein.
      // Abhol-Regeln gelten nur für den Posteingang: Eine gesendete Nachricht
      // als gelesen zu markieren oder wegzuschieben wäre sinnlos bis schädlich.
      if (ergebnis !== 'doppelt' && adapter && bereich === 'posteingang') {
        await wendeAbholRegelnAn(adapter, roh.providerMessageId, einstellungen)
      }
    } catch (err) {
      const grund = err instanceof Error ? err.message : String(err)
      console.error(`[mappe] Import von ${roh.providerMessageId} fehlgeschlagen:`, err)
      bericht.fehler.push({ nachricht: roh.providerMessageId, grund })
    }
  }

  return bericht
}

// 'uebersprungen': gültig, aber ohne Anknüpfungspunkt – etwa eine gesendete
// Nachricht, zu der es keine Bewerbung gibt.
type ImportErgebnis = 'neu' | 'antwort' | 'doppelt' | 'uebersprungen'

async function importiereEine(
  roh: RohMail,
  einstellungen: Settings['mail'],
  stellen: Prisma.JobGetPayload<object>[],
  bereich: Bereich = 'posteingang',
): Promise<ImportErgebnis> {
  // Schon importiert? Dann nichts tun. Der Delta-Sync kann eine Nachricht
  // erneut liefern, etwa wenn sie im Postfach als gelesen markiert wurde.
  const bekannt = await prisma.mailMessage.findUnique({
    where: { providerMessageId: roh.providerMessageId },
    select: { id: true },
  })
  if (bekannt) return 'doppelt'

  const mail = await parseMime(roh.mime, einstellungen.weiterleitungsAdressen)

  // Der echte Absender: bei einer Weiterleitung der ursprüngliche, sonst der
  // aus der Von-Zeile.
  const echterAbsender = mail.weiterleitung.urspruenglicherAbsender ?? mail.von

  // Auch der internetMessageId-Abgleich schützt vor Doppeln – etwa wenn
  // dieselbe Mail über zwei Wege hereinkommt.
  if (mail.internetMessageId) {
    const doppelt = await prisma.mailMessage.findFirst({
      where: { internetMessageId: mail.internetMessageId },
      select: { id: true },
    })
    if (doppelt) return 'doppelt'
  }

  if (bereich === 'gesendet') {
    return importiereGesendete(mail, roh, einstellungen)
  }

  const verlauf = bildeVerlaufsKennung(mail.betreff, echterAbsender.email)

  // Gehört die Nachricht zu einer laufenden Bewerbung? Dann wird sie an den
  // Verlauf gehängt, statt eine zweite Bewerbung anzulegen.
  const bestehende = await prisma.mailMessage.findFirst({
    where: { conversationId: verlauf, applicationId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { applicationId: true },
  })

  const emlAblage = await writeFileTo('mails', `${roh.providerMessageId}.eml`, roh.mime)

  if (bestehende?.applicationId) {
    await speichereMail(mail, roh, verlauf, bestehende.applicationId, emlAblage.storagePath)
    await prisma.application.update({
      where: { id: bestehende.applicationId },
      data: { updatedAt: new Date() },
    })
    // Kein Akteur: Der Abruf läuft im Hintergrund, ohne angemeldeten Nutzer.
    await ereignis(bestehende.applicationId, 'MAIL_EIN', null, {
      betreff: mail.betreff,
      von: echterAbsender.email,
    })
    return 'antwort'
  }

  // --- Neue Bewerbung -------------------------------------------------------
  const { daten, quelle, stellenHinweis } = deuteInhalt(mail, echterAbsender)

  const volltext = await sammleVolltext(mail)
  const ausText = erkenneAusText(volltext, { name: echterAbsender.name, email: echterAbsender.email })

  // Die spezialisierten Parser (Formular, Portale) haben Vorrang; die
  // allgemeine Regelerkennung füllt nur die Lücken.
  const zusammen: ErkannteDaten = { ...ausText, ...entferneLeere(daten) }

  const treffer = ordneStelleZu(mail.betreff, volltext, stellen, stellenHinweis)

  const bewerber = await findeOderLegeBewerberAn(zusammen, echterAbsender)

  const bewerbung = await prisma.application.create({
    data: {
      candidateId: bewerber.id,
      jobId: treffer.jobId,
      speculative: treffer.initiativ,
      source: quelle,
      stage: 'NEU',
      subject: mail.betreff || null,
      appliedAt: mail.eingegangenAm,
      needsReview: true,
    },
  })

  const mailDatensatz = await speichereMail(mail, roh, verlauf, bewerbung.id, emlAblage.storagePath)
  await speichereAnhaenge(mail, mailDatensatz.id, bewerbung.id)

  await ereignis(bewerbung.id, 'ANGELEGT', null, { quelle, betreff: mail.betreff })
  await ereignis(bewerbung.id, 'MAIL_EIN', null, {
    betreff: mail.betreff,
    von: echterAbsender.email,
  })

  await prisma.extractionSuggestion.create({
    data: {
      applicationId: bewerbung.id,
      source: 'REGELN',
      payload: {
        bewerber: zusammen,
        stelle: {
          jobId: treffer.jobId,
          sicherheit: treffer.sicherheit,
          begruendung: treffer.begruendung,
          initiativ: treffer.initiativ,
        },
        weiterleitung: mail.weiterleitung.erkannt
          ? {
              erkannt: true,
              quelle: mail.weiterleitung.quelle,
              urspruenglicherAbsender: mail.weiterleitung.urspruenglicherAbsender,
              vonZeile: mail.von,
            }
          : { erkannt: false },
        quelle,
      } as object,
    },
  })

  await audit(null, 'bewerbung-importiert', 'application', bewerbung.id, {
    quelle,
    absender: echterAbsender.email,
    weitergeleitet: mail.weiterleitung.erkannt,
  })

  // Die KI läuft danach und blockiert den Abruf nicht. Bei einem lokalen
  // Modell dauert eine Bewerbung ein bis zwei Minuten – so lange darf das
  // Einlesen des Postfachs nicht stillstehen.
  planeKiAnalyse(bewerbung.id)

  return 'neu'
}

/**
 * Stößt die KI-Analyse im Hintergrund an, falls sie eingeschaltet ist.
 * Fehler landen im Protokoll und bleiben folgenlos – die Bewerbung ist auch
 * ohne KI vollständig erfasst.
 */
function planeKiAnalyse(applicationId: string): void {
  setImmediate(() => {
    void (async () => {
      try {
        const ki = await getSetting('ki')
        if (!ki.aktiv) return
        await analysiereBewerbung(applicationId, null)
      } catch (err) {
        console.error(
          `[mappe] KI-Analyse für ${applicationId} fehlgeschlagen:`,
          err instanceof Error ? err.message : err,
        )
      }
    })()
  })
}

/** Wählt den passenden Parser und liefert Daten samt erkannter Quelle. */
function deuteInhalt(
  mail: GeparsteMail,
  echterAbsender: { name: string; email: string },
): { daten: ErkannteDaten; quelle: ApplicationSource; stellenHinweis?: string } {
  const portal = erkennePortal(mail)
  if (portal?.erkannt) {
    return { daten: portal.daten, quelle: portal.quelle, stellenHinweis: portal.stelle }
  }

  const formular = parseFormularMail(mail.textInhalt)
  if (formular.erkannt) {
    return { daten: formular.daten, quelle: 'WEBSITE_FORMULAR', stellenHinweis: formular.stelle }
  }

  void echterAbsender
  return { daten: {}, quelle: 'EMAIL' }
}

/** Mailtext plus Text aller angehängten PDFs – die Grundlage jeder Erkennung. */
async function sammleVolltext(mail: GeparsteMail): Promise<string> {
  const teile = [mail.betreff, mail.textInhalt]

  for (const anhang of mail.anhaenge) {
    if (anhang.inline || !istPdf(anhang.mimeTyp, anhang.dateiname)) continue
    try {
      const inhalt = await extrahiereText(anhang.inhalt)
      teile.push(inhalt.gesamtText)
    } catch (err) {
      // Ein verschlüsseltes oder gescanntes PDF liefert keinen Text. Das ist
      // kein Fehler, nur weniger Material für die Erkennung.
      console.warn(`[mappe] Kein Text aus "${anhang.dateiname}":`, (err as Error).message)
    }
  }

  return teile.filter(Boolean).join('\n\n')
}

/**
 * Sucht den Bewerber über die E-Mail-Adresse; nur wenn keine vorliegt, wird
 * ersatzweise über den Namen gesucht. Zwei Menschen mit gleichem Namen sind
 * wahrscheinlicher als zwei mit gleicher Adresse.
 */
async function findeOderLegeBewerberAn(
  daten: ErkannteDaten,
  absender: { name: string; email: string },
): Promise<{ id: string }> {
  const email = daten.email ?? absender.email

  if (email) {
    const vorhanden = await prisma.candidate.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })
    if (vorhanden) {
      // Bekannter Bewerber: nur Lücken füllen, nie Bestehendes überschreiben –
      // von Hand korrigierte Daten sind mehr wert als eine neue Erkennung.
      await prisma.candidate.update({
        where: { id: vorhanden.id },
        data: {
          firstName: vorhanden.firstName || daten.vorname || '',
          lastName: vorhanden.lastName || daten.nachname || '',
          phone: vorhanden.phone ?? daten.telefon ?? null,
        },
      })
      return { id: vorhanden.id }
    }
  }

  return prisma.candidate.create({
    data: {
      salutation: daten.anrede ?? 'KEINE',
      title: daten.titel ?? null,
      firstName: daten.vorname ?? '',
      lastName: daten.nachname ?? '',
      email: email || null,
      phone: daten.telefon ?? null,
      street: daten.strasse ?? null,
      postalCode: daten.plz ?? null,
      city: daten.ort ?? null,
      links: (daten.links ?? []) as object,
    },
    select: { id: true },
  })
}

/**
 * Eine Nachricht aus dem Gesendet-Ordner.
 *
 * Der wichtige Unterschied zum Posteingang: Hieraus entsteht **nie** eine neue
 * Bewerbung. Eine gesendete Nachricht ist keine Bewerbung – fände sich kein
 * passender Verlauf und würde trotzdem etwas angelegt, stünde nach dem ersten
 * Abruf für jede je verschickte Mail eine Karteileiche im Board.
 *
 * Die Verlaufskennung wird über den **Empfänger** gebildet, nicht über den
 * Absender: Absender sind wir selbst, der Bewerber steht in der An-Zeile.
 */
async function importiereGesendete(
  mail: GeparsteMail,
  roh: RohMail,
  einstellungen: Settings['mail'],
): Promise<ImportErgebnis> {
  const empfaenger = mail.an[0]
  if (!empfaenger?.email) return 'uebersprungen'

  const verlauf = bildeVerlaufsKennung(mail.betreff, empfaenger.email)

  const bestehende = await prisma.mailMessage.findFirst({
    where: { conversationId: verlauf, applicationId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { applicationId: true },
  })
  if (!bestehende?.applicationId) return 'uebersprungen'

  // Was Mappe selbst verschickt hat, steht bereits im Verlauf. Über Graph
  // kommt beim Versand keine Kennung zurück, deshalb greift der Abgleich über
  // providerMessageId dort nicht – ohne diese zweite Prüfung stünde jede aus
  // Mappe versandte Mail nach dem nächsten Abruf ein zweites Mal da.
  const gesendetAb = mail.eingegangenAm ?? new Date()
  const eigene = await prisma.mailMessage.findFirst({
    where: {
      applicationId: bestehende.applicationId,
      direction: 'AUSGEHEND',
      subject: mail.betreff,
      toEmails: { has: empfaenger.email },
      sentAt: {
        gte: new Date(gesendetAb.getTime() - 10 * 60 * 1000),
        lte: new Date(gesendetAb.getTime() + 10 * 60 * 1000),
      },
    },
    select: { id: true },
  })
  if (eigene) return 'doppelt'

  const emlAblage = await writeFileTo('mails', `${roh.providerMessageId}.eml`, roh.mime)

  await prisma.mailMessage.create({
    data: {
      applicationId: bestehende.applicationId,
      direction: 'AUSGEHEND',
      status: 'GESENDET',
      providerMessageId: roh.providerMessageId,
      internetMessageId: mail.internetMessageId,
      conversationId: verlauf,
      subject: mail.betreff,
      fromName: mail.von.name,
      fromEmail: mail.von.email,
      toEmails: mail.an.map((a) => a.email),
      ccEmails: mail.kopie.map((a) => a.email),
      bodyText: mail.textInhalt,
      bodyHtml: mail.htmlInhalt,
      emlPath: emlAblage.storagePath,
      sentAt: mail.eingegangenAm,
    },
  })

  // Anhänge bleiben bewusst außen vor: Was wir selbst mitschicken, ist keine
  // Bewerbungsunterlage und hat unter den Dokumenten nichts zu suchen.

  await ereignis(bestehende.applicationId, 'MAIL_AUS', null, {
    betreff: mail.betreff,
    an: mail.an.map((a) => a.email),
    ausDemPostfach: true,
  })

  return 'antwort'
}

async function speichereMail(
  mail: GeparsteMail,
  roh: RohMail,
  verlauf: string,
  applicationId: string,
  emlPfad: string,
) {
  return prisma.mailMessage.create({
    data: {
      applicationId,
      direction: 'EINGEHEND',
      status: 'IMPORTIERT',
      providerMessageId: roh.providerMessageId,
      internetMessageId: mail.internetMessageId,
      conversationId: verlauf,
      subject: mail.betreff,
      fromName: mail.von.name,
      fromEmail: mail.von.email,
      toEmails: mail.an.map((a) => a.email),
      ccEmails: mail.kopie.map((a) => a.email),
      bodyText: mail.textInhalt,
      bodyHtml: mail.htmlInhalt,
      forwarded: mail.weiterleitung.erkannt,
      originalFromEmail: mail.weiterleitung.urspruenglicherAbsender?.email ?? null,
      originalFromName: mail.weiterleitung.urspruenglicherAbsender?.name ?? null,
      emlPath: emlPfad,
      receivedAt: mail.eingegangenAm,
    },
  })
}

async function speichereAnhaenge(
  mail: GeparsteMail,
  mailMessageId: string,
  applicationId: string,
): Promise<void> {
  for (const anhang of mail.anhaenge) {
    // Signaturlogos und andere eingebettete Bilder sind keine Bewerbungsunterlagen.
    if (anhang.inline) continue
    if (anhang.mimeTyp === 'message/rfc822') continue

    const ablage = await writeFileTo('anhaenge', anhang.dateiname, anhang.inhalt)

    let dokumentId: string | null = null
    if (istPdf(anhang.mimeTyp, anhang.dateiname)) {
      let seitenAnzahl: number | null = null
      let text: string | null = null
      try {
        const inhalt = await extrahiereText(anhang.inhalt)
        seitenAnzahl = inhalt.seitenAnzahl
        text = inhalt.gesamtText
      } catch {
        // Gescanntes oder geschütztes PDF – bleibt trotzdem als Dokument liegen.
      }

      const dokument = await prisma.document.create({
        data: {
          applicationId,
          // Beim Import ist noch nichts aufgetrennt: die Datei ist das Original.
          category: 'ORIGINAL',
          filename: anhang.dateiname,
          storagePath: ablage.storagePath,
          mimeType: anhang.mimeTyp,
          size: ablage.size,
          pageCount: seitenAnzahl,
          extractedText: text,
          textExtractedAt: text ? new Date() : null,
        },
      })
      dokumentId = dokument.id
    }

    await prisma.mailAttachment.create({
      data: {
        mailMessageId,
        filename: anhang.dateiname,
        storagePath: ablage.storagePath,
        mimeType: anhang.mimeTyp,
        size: ablage.size,
        documentId: dokumentId,
      },
    })
  }
}

async function wendeAbholRegelnAn(
  adapter: MailAdapter,
  providerMessageId: string,
  einstellungen: Settings['mail'],
): Promise<void> {
  const { alsGelesenMarkieren, inOrdnerVerschieben, ordnerName } = einstellungen.regeln
  try {
    if (alsGelesenMarkieren) await adapter.markiereGelesen(providerMessageId)
    // Reihenfolge zählt: nach dem Verschieben ändert sich bei manchen
    // Anbietern die Kennung, dann greift das Markieren nicht mehr.
    if (inOrdnerVerschieben && ordnerName) {
      await adapter.verschiebeInOrdner(providerMessageId, ordnerName)
    }
  } catch (err) {
    // Die Bewerbung ist bereits sicher im Tool – eine misslungene Aufräumregel
    // darf den Import nicht nachträglich zum Fehler machen.
    console.error('[mappe] Abhol-Regel fehlgeschlagen:', err)
  }
}

function entferneLeere<T extends object>(objekt: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(objekt).filter(([, wert]) => wert !== undefined && wert !== null && wert !== ''),
  ) as Partial<T>
}
