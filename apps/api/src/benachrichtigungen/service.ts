import type { ApplicationStage } from '@prisma/client'
import { prisma } from '../db'
import { getSetting } from '../settings/service'

/**
 * Benachrichtigungen und Erinnerungen.
 *
 * Zwei Anlässe, beide aus dem Alltag:
 *
 *  - **Neue Bewerbung** – damit niemand das Postfach im Auge behalten muss.
 *  - **Liegt zu lange** – die stille Bewerbung, die niemand angefasst hat, ist
 *    der Fall, der Bewerber verärgert und in der Liste untergeht.
 *
 * Zugestellt wird nur in der Oberfläche, nicht per Mail. Ein Werkzeug, das
 * unaufgefordert Mails an die eigene Belegschaft schickt, wird schnell
 * abgeschaltet – und mit ihm die Erinnerungen.
 */

/** Phasen, in denen eine Bewerbung als offen gilt. */
const OFFEN = [
  'NEU',
  'GESICHTET',
  'IN_PRUEFUNG',
  'EINGELADEN',
  'GESPRAECH_GEFUEHRT',
  'ENTSCHEIDUNG',
] satisfies ApplicationStage[]

/**
 * Wer Benachrichtigungen bekommt: Admins und Recruiter.
 *
 * Interviewer bewusst nicht. Sie sehen ohnehin nur zugewiesene Bewerbungen,
 * und eine Meldung über eine Bewerbung, die sie nicht öffnen dürfen, wäre
 * bestenfalls verwirrend.
 */
async function empfaenger(): Promise<{ id: string }[]> {
  return prisma.user.findMany({
    where: { active: true, role: { in: ['ADMIN', 'RECRUITER'] } },
    select: { id: true },
  })
}

/** Meldet eine neu eingegangene Bewerbung. */
export async function meldeNeueBewerbung(applicationId: string): Promise<void> {
  const einstellungen = await getSetting('benachrichtigungen')
  if (!einstellungen.neueBewerbung) return

  const leute = await empfaenger()
  if (leute.length === 0) return

  await prisma.notification.createMany({
    data: leute.map((n) => ({
      userId: n.id,
      applicationId,
      type: 'NEUE_BEWERBUNG' as const,
    })),
    // Der eindeutige Schlüssel fängt den Fall ab, dass derselbe Anlass ein
    // zweites Mal gemeldet wird.
    skipDuplicates: true,
  })
}

/**
 * Sucht Bewerbungen, die zu lange unbearbeitet liegen.
 *
 * Maßstab ist `stageChangedAt`, nicht der Eingang: Eine Bewerbung, die gerade
 * erst auf „Eingeladen" gesetzt wurde, liegt nicht – auch wenn sie vor Monaten
 * eingegangen ist.
 */
export async function pruefeLiegengebliebene(): Promise<number> {
  const einstellungen = await getSetting('benachrichtigungen')
  if (!einstellungen.unbeantwortet) return 0

  const grenze = new Date(Date.now() - einstellungen.tage * 24 * 60 * 60 * 1000)

  const liegend = await prisma.application.findMany({
    where: { stage: { in: OFFEN }, stageChangedAt: { lt: grenze } },
    select: {
      id: true,
      stage: true,
      stageChangedAt: true,
      candidate: { select: { firstName: true, lastName: true, email: true } },
    },
    take: 200,
  })
  if (liegend.length === 0) return 0

  const leute = await empfaenger()
  if (leute.length === 0) return 0

  let angelegt = 0
  for (const bewerbung of liegend) {
    const tage = Math.floor((Date.now() - bewerbung.stageChangedAt.getTime()) / (24 * 60 * 60 * 1000))
    const name =
      `${bewerbung.candidate.firstName} ${bewerbung.candidate.lastName}`.trim() ||
      bewerbung.candidate.email ||
      'Ohne Namen'

    const ergebnis = await prisma.notification.createMany({
      data: leute.map((n) => ({
        userId: n.id,
        applicationId: bewerbung.id,
        type: 'UNBEANTWORTET' as const,
        data: { name, tage, phase: bewerbung.stage } as object,
      })),
      skipDuplicates: true,
    })
    angelegt += ergebnis.count
  }

  return angelegt
}

export async function holeFuer(userId: string, nurUngelesene = false) {
  return prisma.notification.findMany({
    where: { userId, ...(nurUngelesene ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      application: {
        select: {
          id: true,
          stage: true,
          candidate: { select: { firstName: true, lastName: true, email: true } },
          job: { select: { title: true } },
        },
      },
    },
  })
}

export async function markiereGelesen(userId: string, ids: string[] | null): Promise<number> {
  const ergebnis = await prisma.notification.updateMany({
    // Ohne Liste gilt „alles gelesen". Die Einschränkung auf den eigenen
    // Nutzer steht in beiden Fällen – sonst ließen sich mit untergeschobenen
    // Kennungen fremde Benachrichtigungen wegräumen.
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  })
  return ergebnis.count
}
