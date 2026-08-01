import { prisma } from '../db'
import { audit } from '../lib/audit'
import { ereignis } from '../lib/historie'
import { badRequest } from '../lib/errors'
import { readFileFrom } from '../lib/storage'
import { getSetting } from '../settings/service'
import { bildeVerlaufsKennung } from './parse'
import { setzeEin } from './platzhalter'
import { holeAdapter } from './registry'
import { MailFehler } from './types'

/**
 * Versand aus dem Bewerbungspostfach.
 *
 * Es wird immer **als das Postfach** gesendet, nicht als der angemeldete
 * Nutzer – die Antwort soll im gemeinsamen Verlauf landen, nicht in einem
 * persönlichen Postausgang. Wer sie geschrieben hat, steht im Datensatz.
 */

export interface VersandAuftrag {
  applicationId: string
  an: string[]
  kopie?: string[]
  betreff: string
  text: string
  /** Angehängte Dokumente der Bewerbung, etwa zurückgeschickte Unterlagen. */
  dokumentIds?: string[]
}

/**
 * @param userId Wer verschickt. `null` heißt: automatisch erzeugt – dann steht
 *   im Absender der neutrale Name aus den Einstellungen statt eines Menschen,
 *   der gar nichts geschrieben hat.
 */
export async function sendeMail(
  auftrag: VersandAuftrag,
  userId: string | null,
): Promise<{ id: string }> {
  const empfaenger = auftrag.an.map((a) => a.trim().toLowerCase()).filter(Boolean)
  if (empfaenger.length === 0) throw badRequest('Es ist kein Empfänger angegeben.')
  if (!auftrag.betreff.trim()) throw badRequest('Der Betreff ist leer.')
  if (!auftrag.text.trim()) throw badRequest('Die Nachricht ist leer.')

  const bewerbung = await prisma.application.findUnique({
    where: { id: auftrag.applicationId },
    include: { candidate: { select: { id: true, email: true } } },
  })
  if (!bewerbung) throw badRequest('Diese Bewerbung gibt es nicht.')

  const adapter = await holeAdapter()
  if (!adapter) {
    throw new MailFehler(
      'Es ist kein Postfach angebunden. Unter Einstellungen → Mail-Anbindung lässt sich eines hinterlegen.',
    )
  }

  // An den letzten eingegangenen Faden anknüpfen, damit die Antwort beim
  // Bewerber im richtigen Verlauf landet und nicht als neue Mail erscheint.
  const letzteEingehende = await prisma.mailMessage.findFirst({
    where: { applicationId: auftrag.applicationId, direction: 'EINGEHEND' },
    orderBy: { receivedAt: 'desc' },
    select: { internetMessageId: true, conversationId: true },
  })

  const anhaenge = auftrag.dokumentIds?.length
    ? await ladeAnhaenge(auftrag.dokumentIds, auftrag.applicationId)
    : undefined

  // Der Datensatz entsteht *vor* dem Versand. Bricht der Versand ab, ist der
  // Versuch dokumentiert statt spurlos verschwunden.
  const datensatz = await prisma.mailMessage.create({
    data: {
      applicationId: auftrag.applicationId,
      candidateId: bewerbung.candidate.id,
      direction: 'AUSGEHEND',
      status: 'ENTWURF',
      subject: auftrag.betreff,
      toEmails: empfaenger,
      ccEmails: auftrag.kopie ?? [],
      bodyText: auftrag.text,
      conversationId:
        letzteEingehende?.conversationId ??
        bildeVerlaufsKennung(auftrag.betreff, bewerbung.candidate.email ?? empfaenger[0]),
      sentById: userId,
    },
  })

  try {
    await adapter.sende({
      absenderName: await baueAbsenderNamen(userId),
      an: empfaenger,
      kopie: auftrag.kopie,
      betreff: auftrag.betreff,
      text: auftrag.text,
      antwortAuf: letzteEingehende,
      anhaenge,
    })

    await prisma.mailMessage.update({
      where: { id: datensatz.id },
      data: { status: 'GESENDET', sentAt: new Date(), error: null },
    })

    await audit(userId, 'mail-gesendet', 'application', auftrag.applicationId, {
      an: empfaenger,
      betreff: auftrag.betreff,
    })
    await ereignis(auftrag.applicationId, 'MAIL_AUS', userId, {
      betreff: auftrag.betreff,
      an: empfaenger,
    })

    return { id: datensatz.id }
  } catch (err) {
    const meldung = err instanceof Error ? err.message : String(err)
    await prisma.mailMessage.update({
      where: { id: datensatz.id },
      data: { status: 'FEHLGESCHLAGEN', error: meldung },
    })
    throw new MailFehler(`Die Mail konnte nicht gesendet werden: ${meldung}`, err)
  }
}

async function ladeAnhaenge(dokumentIds: string[], applicationId: string) {
  // Nur Dokumente dieser Bewerbung – sonst ließe sich über eine untergeschobene
  // Kennung eine fremde Bewerbungsunterlage verschicken.
  const dokumente = await prisma.document.findMany({
    where: { id: { in: dokumentIds }, applicationId },
  })
  if (dokumente.length !== dokumentIds.length) {
    throw badRequest('Mindestens ein Anhang gehört nicht zu dieser Bewerbung.')
  }

  return Promise.all(
    dokumente.map(async (dokument) => ({
      dateiname: dokument.filename,
      inhalt: await readFileFrom(dokument.storagePath),
      mimeTyp: dokument.mimeType,
    })),
  )
}

/**
 * Baut den angezeigten Absendernamen.
 *
 * Von Hand verschickt zeigt standardmäßig Bearbeiter und Organisation, damit
 * der Bewerber weiß, wer sich meldet. Automatisch erzeugte Mails tragen den
 * neutralen Namen aus den Einstellungen – dort einen Menschen zu nennen wäre
 * schlicht falsch. Beide Zeilen sind in den Einstellungen frei änderbar.
 *
 * Bleibt nach dem Einsetzen nichts übrig – etwa weil weder Organisation noch
 * Absendername gepflegt sind –, wird gar kein Name gesetzt. Ein Absender wie
 * „ – " sieht nach einem Fehler aus; dann lieber nur die Adresse.
 */
async function baueAbsenderNamen(userId: string | null): Promise<string | undefined> {
  const allgemein = await getSetting('allgemein')

  const bearbeiter = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    : null

  const vorlage = bearbeiter ? allgemein.absenderNameManuell : allgemein.absenderNameAutomatisch
  if (!vorlage.trim()) return undefined

  const werte: Record<string, string> = {
    ABSENDER: allgemein.absenderName || allgemein.organisation,
    ORGANISATION: allgemein.organisation,
    BEARBEITER: bearbeiter?.name ?? '',
  }

  const name = setzeEin(vorlage, werte)
    .text.replace(/\s*[–-]\s*$/, '')
    .replace(/^\s*[–-]\s*/, '')
    .trim()

  return name || undefined
}
