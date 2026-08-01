import type { EventType } from '@prisma/client'
import { prisma } from '../db'
import type { AuthUser } from '../auth/middleware'

/**
 * Schreibt einen Eintrag in die Historie einer Bewerbung.
 *
 * Abgrenzung zum Protokoll (`audit`): Das Protokoll ist ein
 * Verwaltungswerkzeug für DSGVO-Vorgänge und Interviewern gesperrt. Die
 * Historie gehört zur Bewerbung und wird im Alltag gelesen – sie beantwortet
 * „was ist mit dieser Bewerbung bisher passiert, und wer war das?".
 *
 * Der Name des Handelnden wird mitgeschrieben, nicht nur die Kennung. Wird ein
 * Konto später gelöscht, setzt Prisma die Relation auf null; ohne den
 * festgehaltenen Namen stünde die halbe Historie danach anonym da – und genau
 * das „wer war das" wäre verloren.
 */
export async function ereignis(
  applicationId: string,
  type: EventType,
  // Auch eine blanke Nutzerkennung ist erlaubt: An manchen Stellen – etwa beim
  // Mailversand – liegt nur sie vor. Der Name wird dann nachgeschlagen, damit
  // die Regel „Name wird mitgeschrieben" keine Lücken bekommt.
  akteur: AuthUser | { id: string; name: string } | string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    let userId: string | null = null
    let actorName = ''

    if (typeof akteur === 'string') {
      userId = akteur
      const nutzer = await prisma.user.findUnique({
        where: { id: akteur },
        select: { name: true },
      })
      actorName = nutzer?.name ?? ''
    } else if (akteur) {
      userId = akteur.id
      actorName = akteur.name
    }

    await prisma.applicationEvent.create({
      data: {
        applicationId,
        userId,
        // Ohne Akteur war es das System – der Mail-Abruf etwa läuft ohne
        // angemeldeten Nutzer.
        actorName,
        type,
        data: data as object,
      },
    })
  } catch (err) {
    // Wie beim Protokoll: Ein fehlgeschlagener Eintrag darf den eigentlichen
    // Vorgang nie scheitern lassen.
    console.error('[mappe] Historien-Eintrag fehlgeschlagen:', err)
  }
}
