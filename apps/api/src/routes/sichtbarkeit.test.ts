import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '../auth/middleware'
import { prisma } from '../db'
import { baueBewerbungsFilter } from './bewerbungen'

/**
 * Sichtbarkeit für Interviewer.
 *
 * Geprüft wird gegen die echte Datenbank, nicht gegen die Form des
 * Filterobjekts: Ob eine Bedingung wirkt, entscheidet Prisma, nicht wie das
 * Objekt aussieht. Genau daran ist die erste Fassung gescheitert – sie sah
 * richtig aus und ließ trotzdem alles durch.
 */

let interviewer: AuthUser
let recruiter: AuthUser
let zugewiesen: string
let fremd: string
let ueberStelle: string

async function baueDatenAuf(): Promise<void> {
  const nutzerInterviewer = await prisma.user.create({
    data: { email: 'interviewer@test.local', name: 'Ina Interviewer', role: 'INTERVIEWER' },
  })
  const nutzerRecruiter = await prisma.user.create({
    data: { email: 'recruiter@test.local', name: 'Rolf Recruiter', role: 'RECRUITER' },
  })

  interviewer = {
    id: nutzerInterviewer.id,
    email: nutzerInterviewer.email,
    name: nutzerInterviewer.name,
    role: 'INTERVIEWER',
  }
  recruiter = {
    id: nutzerRecruiter.id,
    email: nutzerRecruiter.email,
    name: nutzerRecruiter.name,
    role: 'RECRUITER',
  }

  const stelleMitGremium = await prisma.job.create({ data: { title: 'Bürokraft' } })
  const andereStelle = await prisma.job.create({ data: { title: 'Mediengestalter' } })

  // Die Interviewerin sitzt im Gremium der einen Stelle.
  await prisma.jobAssignment.create({
    data: { jobId: stelleMitGremium.id, userId: nutzerInterviewer.id },
  })

  const a = await prisma.candidate.create({ data: { lastName: 'Zugewiesen', email: 'a@test.local' } })
  const b = await prisma.candidate.create({ data: { lastName: 'Fremd', email: 'b@test.local' } })
  const c = await prisma.candidate.create({ data: { lastName: 'Gremium', email: 'c@test.local' } })

  // 1) Einzeln zugewiesen
  const bewerbungA = await prisma.application.create({
    data: { candidateId: a.id, jobId: andereStelle.id, subject: 'Bewerbung Zugewiesen' },
  })
  await prisma.applicationAssignment.create({
    data: { applicationId: bewerbungA.id, userId: nutzerInterviewer.id },
  })
  zugewiesen = bewerbungA.id

  // 2) Gar nicht zugewiesen – darf nie auftauchen
  const bewerbungB = await prisma.application.create({
    data: { candidateId: b.id, jobId: andereStelle.id, subject: 'Bewerbung Fremd' },
  })
  fremd = bewerbungB.id

  // 3) Über die Stelle sichtbar
  const bewerbungC = await prisma.application.create({
    data: { candidateId: c.id, jobId: stelleMitGremium.id, subject: 'Bewerbung Gremium' },
  })
  ueberStelle = bewerbungC.id
}

async function raeumeAuf(): Promise<void> {
  await prisma.applicationAssignment.deleteMany()
  await prisma.jobAssignment.deleteMany()
  await prisma.application.deleteMany()
  await prisma.candidate.deleteMany()
  await prisma.job.deleteMany()
  await prisma.user.deleteMany()
}

async function finde(user: AuthUser, filter: Parameters<typeof baueBewerbungsFilter>[1] = {}) {
  return prisma.application.findMany({
    where: baueBewerbungsFilter(user, filter),
    select: { id: true },
  })
}

beforeEach(async () => {
  await raeumeAuf()
  await baueDatenAuf()
})

afterAll(async () => {
  await raeumeAuf()
  await prisma.$disconnect()
})

describe('Interviewer ohne Filter', () => {
  it('sieht nur zugewiesene Bewerbungen und die des eigenen Gremiums', async () => {
    const treffer = await finde(interviewer)
    const ids = treffer.map((t) => t.id).sort()
    expect(ids).toEqual([zugewiesen, ueberStelle].sort())
    expect(ids).not.toContain(fremd)
  })
})

describe('Interviewer mit Suche', () => {
  it('sieht eine fremde Bewerbung auch dann nicht, wenn die Suche darauf passt', async () => {
    // Der Fehler, der hier abgefangen wird: Das OR der Suche überschrieb das
    // OR der Sichtbarkeitsprüfung, sobald beide nebeneinander gespreadet
    // wurden. Ein Tippen ins Suchfeld öffnete damit das ganze Haus.
    const treffer = await finde(interviewer, { suche: 'Fremd' })
    expect(treffer.map((t) => t.id)).not.toContain(fremd)
    expect(treffer).toHaveLength(0)
  })

  it('findet die eigene Bewerbung über die Suche weiterhin', async () => {
    const treffer = await finde(interviewer, { suche: 'Zugewiesen' })
    expect(treffer.map((t) => t.id)).toEqual([zugewiesen])
  })

  it('lässt auch eine leere Suche nicht durchrutschen', async () => {
    const treffer = await finde(interviewer, { suche: 'Bewerbung' })
    expect(treffer.map((t) => t.id).sort()).toEqual([zugewiesen, ueberStelle].sort())
  })
})

describe('Interviewer mit weiteren Filtern', () => {
  it.each([
    ['Phase', { phase: 'NEU' as const }],
    ['Quelle', { quelle: 'EMAIL' as const }],
    ['nur zu prüfen', { nurZuPruefen: true }],
    ['Initiativ', { initiativ: false }],
  ])('hebelt die Prüfung mit dem Filter „%s" nicht aus', async (_name, filter) => {
    const treffer = await finde(interviewer, filter)
    expect(treffer.map((t) => t.id)).not.toContain(fremd)
  })

  it('kann auch bei Filterkombinationen nichts Fremdes sehen', async () => {
    const treffer = await finde(interviewer, {
      suche: 'Bewerbung',
      phase: 'NEU',
      quelle: 'EMAIL',
      nurZuPruefen: true,
    })
    expect(treffer.map((t) => t.id)).not.toContain(fremd)
  })
})

describe('Recruiter', () => {
  it('sieht alles', async () => {
    const treffer = await finde(recruiter)
    expect(treffer).toHaveLength(3)
  })

  it('bekommt die Suche unverändert angewendet', async () => {
    const treffer = await finde(recruiter, { suche: 'Fremd' })
    expect(treffer.map((t) => t.id)).toEqual([fremd])
  })
})
