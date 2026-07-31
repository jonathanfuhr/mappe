import { prisma } from '../db'
import { audit } from '../lib/audit'
import { badRequest } from '../lib/errors'
import { readFileFrom } from '../lib/storage'
import { bildeVerlaufsKennung } from './parse'
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

export async function sendeMail(auftrag: VersandAuftrag, userId: string): Promise<{ id: string }> {
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
