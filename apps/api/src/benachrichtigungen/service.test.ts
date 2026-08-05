import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { clearSettingsCache, updateSetting } from '../settings/service'
import { versendeBenachrichtigungsMails } from './mail'
import { meldeNeueBewerbung, pruefeLiegengebliebene } from './service'

/**
 * Erinnerungen sind der Teil, der leise falsch sein kann: Eine Meldung zu viel
 * nervt so lange, bis niemand mehr hinsieht – und dann fehlt auch die, auf die
 * es ankam.
 */

function vorTagen(tage: number): Date {
  return new Date(Date.now() - tage * 24 * 60 * 60 * 1000)
}

async function stelleEin(teil: Record<string, unknown> = {}): Promise<void> {
  await updateSetting('benachrichtigungen', {
    neueBewerbung: true,
    unbeantwortet: true,
    tage: 14,
    perMail: false,
    ...teil,
  })
  clearSettingsCache()
}

async function legeAn(optionen: {
  nachname: string
  phase?: 'NEU' | 'EINGELADEN' | 'ZUSAGE' | 'ABSAGE'
  seitTagen?: number
}) {
  const bewerber = await prisma.candidate.create({
    data: { lastName: optionen.nachname, email: `${optionen.nachname.toLowerCase()}@example.com` },
  })
  return prisma.application.create({
    data: {
      candidateId: bewerber.id,
      stage: optionen.phase ?? 'NEU',
      stageChangedAt: vorTagen(optionen.seitTagen ?? 0),
    },
  })
}

async function raeumeAuf(): Promise<void> {
  await prisma.notification.deleteMany()
  await prisma.application.deleteMany()
  await prisma.candidate.deleteMany()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany({ where: { key: 'benachrichtigungen' } })
  clearSettingsCache()
}

let recruiter: string
let interviewer: string

beforeEach(async () => {
  await raeumeAuf()
  const r = await prisma.user.create({
    data: { email: 'r@test.local', name: 'Rolf Recruiter', role: 'RECRUITER' },
  })
  const i = await prisma.user.create({
    data: { email: 'i@test.local', name: 'Ina Interviewer', role: 'INTERVIEWER' },
  })
  recruiter = r.id
  interviewer = i.id
})

afterAll(async () => {
  await raeumeAuf()
  await prisma.$disconnect()
})

describe('Neue Bewerbung', () => {
  it('meldet an Recruiter, aber nicht an Interviewer', async () => {
    await stelleEin()
    const bewerbung = await legeAn({ nachname: 'Neu' })

    await meldeNeueBewerbung(bewerbung.id)

    const alle = await prisma.notification.findMany()
    expect(alle).toHaveLength(1)
    expect(alle[0].userId).toBe(recruiter)
    expect(alle.some((n) => n.userId === interviewer)).toBe(false)
  })

  it('meldet nichts, wenn die Benachrichtigung abgeschaltet ist', async () => {
    await stelleEin({ neueBewerbung: false })
    const bewerbung = await legeAn({ nachname: 'Still' })

    await meldeNeueBewerbung(bewerbung.id)

    expect(await prisma.notification.count()).toBe(0)
  })
})

describe('Liegengebliebene Bewerbungen', () => {
  it('erinnert an eine Bewerbung, die länger als die Frist liegt', async () => {
    await stelleEin({ tage: 14 })
    await legeAn({ nachname: 'Liegt', seitTagen: 20 })

    const angelegt = await pruefeLiegengebliebene()

    expect(angelegt).toBe(1)
    const eintrag = await prisma.notification.findFirstOrThrow()
    expect(eintrag.type).toBe('UNBEANTWORTET')
    expect((eintrag.data as { tage: number }).tage).toBeGreaterThanOrEqual(20)
  })

  it('lässt eine frische Bewerbung in Ruhe', async () => {
    await stelleEin({ tage: 14 })
    await legeAn({ nachname: 'Frisch', seitTagen: 3 })

    expect(await pruefeLiegengebliebene()).toBe(0)
  })

  it('erinnert nicht an abgeschlossene Bewerbungen', async () => {
    await stelleEin({ tage: 14 })
    await legeAn({ nachname: 'Abgesagt', phase: 'ABSAGE', seitTagen: 90 })
    await legeAn({ nachname: 'Eingestellt', phase: 'ZUSAGE', seitTagen: 90 })

    expect(await pruefeLiegengebliebene()).toBe(0)
  })

  it('meldet denselben Fall kein zweites Mal', async () => {
    await stelleEin({ tage: 14 })
    await legeAn({ nachname: 'Doppelt', seitTagen: 30 })

    expect(await pruefeLiegengebliebene()).toBe(1)
    // Der zweite Lauf darf nichts Neues anlegen – sonst stünde nach einer Woche
    // dieselbe Bewerbung sieben Mal im Postfach.
    expect(await pruefeLiegengebliebene()).toBe(0)
    expect(await prisma.notification.count()).toBe(1)
  })

  it('rechnet ab dem letzten Phasenwechsel, nicht ab dem Eingang', async () => {
    await stelleEin({ tage: 14 })
    // Vor Monaten eingegangen, aber gerade erst weitergeschoben: Die liegt nicht.
    const bewerbung = await legeAn({ nachname: 'Bewegt', phase: 'EINGELADEN', seitTagen: 1 })
    await prisma.application.update({
      where: { id: bewerbung.id },
      data: { appliedAt: vorTagen(120) },
    })

    expect(await pruefeLiegengebliebene()).toBe(0)
  })
})

describe('Mails werden gebündelt', () => {
  it('verschickt nichts, solange der Mailversand aus ist', async () => {
    await stelleEin({ perMail: false })
    const bewerbung = await legeAn({ nachname: 'Aus' })
    await meldeNeueBewerbung(bewerbung.id)

    expect(await versendeBenachrichtigungsMails()).toBe(0)
    const offen = await prisma.notification.findFirstOrThrow()
    expect(offen.mailedAt).toBeNull()
  })

  it('verschickt nichts ohne angebundenes Postfach', async () => {
    // Kein Adapter eingerichtet: Der Lauf darf nicht scheitern, sondern
    // schlicht nichts tun – die Meldungen bleiben für später offen.
    await stelleEin({ perMail: true })
    const bewerbung = await legeAn({ nachname: 'OhnePostfach' })
    await meldeNeueBewerbung(bewerbung.id)

    expect(await versendeBenachrichtigungsMails()).toBe(0)
    const offen = await prisma.notification.findFirstOrThrow()
    expect(offen.mailedAt).toBeNull()
  })

  it('überspringt, wer Mails für sich abgeschaltet hat', async () => {
    await stelleEin({ perMail: true })
    await prisma.user.update({ where: { id: recruiter }, data: { notifyByMail: false } })
    const bewerbung = await legeAn({ nachname: 'Stumm' })
    await meldeNeueBewerbung(bewerbung.id)

    // Die Meldung steht weiterhin in der Oberfläche – nur eine Mail gibt es
    // nicht. Deshalb bleibt sie ungelesen und ohne mailedAt.
    const eintrag = await prisma.notification.findFirstOrThrow()
    expect(eintrag.userId).toBe(recruiter)
    expect(await versendeBenachrichtigungsMails()).toBe(0)
  })

  it('lässt bereits Gelesenes aus', async () => {
    await stelleEin({ perMail: true })
    const bewerbung = await legeAn({ nachname: 'Gelesen' })
    await meldeNeueBewerbung(bewerbung.id)
    await prisma.notification.updateMany({ data: { readAt: new Date() } })

    // Wer es in der Oberfläche schon gesehen hat, braucht dazu keine Mail.
    expect(await versendeBenachrichtigungsMails()).toBe(0)
  })
})
