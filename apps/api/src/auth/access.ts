import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { forbidden, notFound } from '../lib/errors'
import type { AuthUser } from './middleware'

/**
 * Need-to-know für Interviewer: sie sehen nur Bewerbungen, die ihnen einzeln
 * zugewiesen wurden, oder solche zu einer Stelle, für die sie im Gremium
 * sitzen. Admin und Recruiter sehen alles.
 */
export function applicationScope(user: AuthUser): Prisma.ApplicationWhereInput {
  if (user.role !== 'INTERVIEWER') return {}
  return {
    OR: [
      { assignments: { some: { userId: user.id } } },
      { job: { assignments: { some: { userId: user.id } } } },
    ],
  }
}

export function canSeeAllCandidates(user: AuthUser): boolean {
  return user.role === 'ADMIN' || user.role === 'RECRUITER'
}

/** Wirft 404, wenn die Bewerbung nicht existiert *oder* nicht sichtbar ist. */
export async function assertCanViewApplication(user: AuthUser, applicationId: string): Promise<void> {
  const found = await prisma.application.findFirst({
    where: { id: applicationId, ...applicationScope(user) },
    select: { id: true },
  })
  if (!found) throw notFound('Diese Bewerbung gibt es nicht oder sie ist nicht freigegeben.')
}

/**
 * Schreibrechte am Bewerbungsverlauf: Phase ändern, Mails senden, Dokumente
 * verwalten. Interviewer dürfen ausschließlich bewerten und Notizen schreiben.
 */
export async function assertCanEditApplication(user: AuthUser, applicationId: string): Promise<void> {
  if (user.role === 'INTERVIEWER') {
    throw forbidden('Interviewer können bewerten und Notizen schreiben, aber nichts ändern.')
  }
  const found = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true },
  })
  if (!found) throw notFound('Diese Bewerbung gibt es nicht.')
}

/** Bewerten und Notieren darf jeder, der die Bewerbung überhaupt sieht. */
export async function assertCanCommentApplication(
  user: AuthUser,
  applicationId: string,
): Promise<void> {
  await assertCanViewApplication(user, applicationId)
}

/** Bewerber-Datensätze sind für Interviewer nur über ihre Bewerbungen sichtbar. */
export async function assertCanViewCandidate(user: AuthUser, candidateId: string): Promise<void> {
  if (canSeeAllCandidates(user)) {
    const found = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    })
    if (!found) throw notFound('Diesen Bewerber gibt es nicht.')
    return
  }
  const visible = await prisma.application.findFirst({
    where: { candidateId, ...applicationScope(user) },
    select: { id: true },
  })
  if (!visible) throw notFound('Diesen Bewerber gibt es nicht oder er ist nicht freigegeben.')
}
