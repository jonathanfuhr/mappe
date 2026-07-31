import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { fileExists, writeFileTo } from '../lib/storage'
import { clearSettingsCache, updateSetting } from '../settings/service'
import { berechneFristen, holeStand, listeFaellige, loescheFaellige } from './service'

/**
 * Die Fristenlogik ist der Teil, bei dem ein Fehler echten Schaden anrichtet:
 * Löscht sie zu früh, sind Bewerbungsunterlagen mitten im Verfahren weg.
 * Entsprechend gründlich wird hier geprüft.
 */

function vorMonaten(monate: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - monate)
  return d
}

async function stelleFristenEin(teil: Record<string, unknown> = {}): Promise<void> {
  await updateSetting('fristen', {
    bewerbungAktiv: true,
    bewerbungMonate: 6,
    personAktiv: true,
    personMonate: 6,
    modus: 'erinnern',
    ...teil,
  })
  clearSettingsCache()
}

async function legeAn(optionen: {
  nachname: string
  phase?: 'NEU' | 'ABSAGE' | 'ZUSAGE'
  abgeschlossenVorMonaten?: number
  abgeschlossenVorTagen?: number
  einwilligung?: boolean
  ohneBewerbung?: boolean
}) {
  const bewerber = await prisma.candidate.create({
    data: {
      lastName: optionen.nachname,
      email: `${optionen.nachname.toLowerCase()}@example.com`,
      storageConsent: optionen.einwilligung ?? false,
      storageConsentDate: optionen.einwilligung ? new Date() : null,
    },
  })
  if (optionen.ohneBewerbung) return { bewerber, bewerbung: null }

  const abgeschlossen =
    optionen.abgeschlossenVorMonaten !== undefined || optionen.abgeschlossenVorTagen !== undefined
  const abschluss =
    optionen.abgeschlossenVorTagen !== undefined
      ? new Date(Date.now() - optionen.abgeschlossenVorTagen * 24 * 60 * 60 * 1000)
      : optionen.abgeschlossenVorMonaten !== undefined
        ? vorMonaten(optionen.abgeschlossenVorMonaten)
        : null
  const bewerbung = await prisma.application.create({
    data: {
      candidateId: bewerber.id,
      stage: optionen.phase ?? (abgeschlossen ? 'ABSAGE' : 'NEU'),
      closedAt: abschluss,
    },
  })
  return { bewerber, bewerbung }
}

async function raeumeAuf(): Promise<void> {
  await prisma.document.deleteMany()
  await prisma.mailAttachment.deleteMany()
  await prisma.mailMessage.deleteMany()
  await prisma.application.deleteMany()
  await prisma.candidate.deleteMany()
  await prisma.setting.deleteMany({ where: { key: 'fristen' } })
  clearSettingsCache()
}

beforeEach(raeumeAuf)
afterAll(async () => {
  await raeumeAuf()
  await prisma.$disconnect()
})

describe('Fristen berechnen', () => {
  it('setzt die Fälligkeit einer abgeschlossenen Bewerbung auf Abschluss plus Frist', async () => {
    await stelleFristenEin()
    const { bewerbung } = await legeAn({ nachname: 'Alt', abgeschlossenVorMonaten: 8 })

    await berechneFristen()

    const geprueft = await prisma.application.findUniqueOrThrow({ where: { id: bewerbung!.id } })
    expect(geprueft.purgeDueAt).not.toBeNull()
    // Vor acht Monaten abgeschlossen, sechs Monate Frist: längst fällig.
    expect(geprueft.purgeDueAt!.getTime()).toBeLessThan(Date.now())
  })

  it('lässt ein laufendes Verfahren ohne Fälligkeit', async () => {
    await stelleFristenEin()
    const { bewerbung } = await legeAn({ nachname: 'Laufend', phase: 'NEU' })

    await berechneFristen()

    const geprueft = await prisma.application.findUniqueOrThrow({ where: { id: bewerbung!.id } })
    expect(geprueft.purgeDueAt).toBeNull()
  })

  it('räumt die Fälligkeit weg, wenn eine Bewerbung wieder aufgenommen wird', async () => {
    await stelleFristenEin()
    const { bewerbung } = await legeAn({ nachname: 'Zurueck', abgeschlossenVorMonaten: 8 })
    await berechneFristen()

    await prisma.application.update({
      where: { id: bewerbung!.id },
      data: { stage: 'IN_PRUEFUNG', closedAt: null },
    })
    await berechneFristen()

    const geprueft = await prisma.application.findUniqueOrThrow({ where: { id: bewerbung!.id } })
    expect(geprueft.purgeDueAt).toBeNull()
  })

  it('setzt bei einer Person mit laufender Bewerbung keine Fälligkeit', async () => {
    // Der wichtigste Fall: Eine alte Bewerbung darf niemanden löschen, der
    // gerade mitten in einem neuen Verfahren steckt.
    await stelleFristenEin()
    const { bewerber } = await legeAn({ nachname: 'Doppelt', abgeschlossenVorMonaten: 12 })
    await prisma.application.create({ data: { candidateId: bewerber.id, stage: 'EINGELADEN' } })

    await berechneFristen()

    const geprueft = await prisma.candidate.findUniqueOrThrow({ where: { id: bewerber.id } })
    expect(geprueft.purgeDueAt).toBeNull()
  })

  it('nimmt eine Person mit Einwilligung vollständig aus', async () => {
    await stelleFristenEin()
    const { bewerber } = await legeAn({
      nachname: 'Pool',
      abgeschlossenVorMonaten: 24,
      einwilligung: true,
    })

    await berechneFristen()

    const geprueft = await prisma.candidate.findUniqueOrThrow({ where: { id: bewerber.id } })
    expect(geprueft.purgeDueAt).toBeNull()
  })

  it('räumt alle Fälligkeiten weg, wenn die Frist abgeschaltet wird', async () => {
    await stelleFristenEin()
    await legeAn({ nachname: 'Aus', abgeschlossenVorMonaten: 12 })
    await berechneFristen()

    await stelleFristenEin({ bewerbungAktiv: false, personAktiv: false })
    await berechneFristen()

    expect(await prisma.application.count({ where: { purgeDueAt: { not: null } } })).toBe(0)
    expect(await prisma.candidate.count({ where: { purgeDueAt: { not: null } } })).toBe(0)
  })

  it('rechnet eine geänderte Fristlänge sofort neu', async () => {
    await stelleFristenEin({ bewerbungMonate: 24 })
    const { bewerbung } = await legeAn({ nachname: 'Lang', abgeschlossenVorMonaten: 8 })
    await berechneFristen()

    let geprueft = await prisma.application.findUniqueOrThrow({ where: { id: bewerbung!.id } })
    expect(geprueft.purgeDueAt!.getTime()).toBeGreaterThan(Date.now())

    await stelleFristenEin({ bewerbungMonate: 6 })
    await berechneFristen()

    geprueft = await prisma.application.findUniqueOrThrow({ where: { id: bewerbung!.id } })
    expect(geprueft.purgeDueAt!.getTime()).toBeLessThan(Date.now())
  })
})

describe('Übersicht', () => {
  it('zählt fällige, demnächst fällige und zurückgestellte Einträge', async () => {
    await stelleFristenEin()
    await legeAn({ nachname: 'Faellig', abgeschlossenVorMonaten: 9 })
    // Vor gut fünfeinhalb Monaten abgeschlossen: fällig in rund zwei Wochen.
    await legeAn({ nachname: 'Bald', abgeschlossenVorTagen: 168 })
    await legeAn({ nachname: 'Pool', abgeschlossenVorMonaten: 24, einwilligung: true })

    const stand = await holeStand()

    expect(stand.bewerbungen.faellig).toBe(1)
    expect(stand.bewerbungen.demnaechst).toBe(1)
    expect(stand.zurueckgestellt).toBe(1)
    expect(stand.modus).toBe('erinnern')
  })

  it('listet die fälligen Einträge mit Namen auf', async () => {
    await stelleFristenEin()
    await legeAn({ nachname: 'Faellig', abgeschlossenVorMonaten: 9 })

    const liste = await listeFaellige()

    expect(liste.length).toBeGreaterThanOrEqual(1)
    expect(liste.some((e) => e.name.includes('Faellig'))).toBe(true)
  })
})

describe('Löschlauf', () => {
  it('löscht fällige Bewerbungen samt Dateien und lässt laufende stehen', async () => {
    await stelleFristenEin()
    const { bewerbung } = await legeAn({ nachname: 'Weg', abgeschlossenVorMonaten: 9 })
    await legeAn({ nachname: 'Bleibt', phase: 'NEU' })

    const ablage = await writeFileTo('dokumente', 'zeugnis.pdf', Buffer.from('%PDF-1.4 test'))
    await prisma.document.create({
      data: {
        applicationId: bewerbung!.id,
        category: 'ORIGINAL',
        filename: 'zeugnis.pdf',
        storagePath: ablage.storagePath,
        mimeType: 'application/pdf',
        size: ablage.size,
      },
    })

    const bericht = await loescheFaellige(null)

    expect(bericht.bewerbungen).toBe(1)
    expect(bericht.dateien).toBe(1)
    expect(await fileExists(ablage.storagePath)).toBe(false)
    expect(await prisma.application.count()).toBe(1)
  })

  it('rührt Personen mit Einwilligung nicht an', async () => {
    await stelleFristenEin()
    await legeAn({ nachname: 'Pool', abgeschlossenVorMonaten: 24, einwilligung: true })

    const bericht = await loescheFaellige(null)

    expect(bericht.bewerbungen).toBe(0)
    expect(bericht.personen).toBe(0)
    expect(await prisma.candidate.count()).toBe(1)
  })

  it('löscht die Person im selben Lauf, sobald ihre letzte Bewerbung weg ist', async () => {
    // Erst die Bewerbung, dann wird die Person frei von Bewerbungen und im
    // selben Durchgang ebenfalls fällig.
    await stelleFristenEin()
    await legeAn({ nachname: 'Komplett', abgeschlossenVorMonaten: 12 })

    const bericht = await loescheFaellige(null)

    expect(bericht.bewerbungen).toBe(1)
    expect(bericht.personen).toBe(1)
    expect(await prisma.candidate.count()).toBe(0)
  })

  it('lässt eine Person mit laufender Bewerbung stehen', async () => {
    await stelleFristenEin()
    const { bewerber } = await legeAn({ nachname: 'Aktiv', abgeschlossenVorMonaten: 12 })
    await prisma.application.create({ data: { candidateId: bewerber.id, stage: 'EINGELADEN' } })

    const bericht = await loescheFaellige(null)

    expect(bericht.bewerbungen).toBe(1)
    expect(bericht.personen).toBe(0)
    expect(await prisma.candidate.count()).toBe(1)
  })

  it('schreibt jede Löschung ins Protokoll', async () => {
    await stelleFristenEin()
    // Person samt einziger Bewerbung – sie wird als Person gelöscht und nimmt
    // die Bewerbung per Cascade mit.
    await legeAn({ nachname: 'Protokoll', abgeschlossenVorMonaten: 12 })
    // Person mit laufendem zweiten Verfahren – hier wird nur die alte
    // Bewerbung einzeln gelöscht.
    const { bewerber } = await legeAn({ nachname: 'Einzeln', abgeschlossenVorMonaten: 12 })
    await prisma.application.create({ data: { candidateId: bewerber.id, stage: 'EINGELADEN' } })
    await prisma.auditLog.deleteMany()

    await loescheFaellige(null)

    const eintraege = await prisma.auditLog.findMany()
    const person = eintraege.find((e) => e.action === 'frist-person-geloescht')
    expect(person).toBeDefined()
    expect((person!.meta as { mitBewerbungen: number }).mitBewerbungen).toBe(1)
    expect(eintraege.some((e) => e.action === 'frist-bewerbung-geloescht')).toBe(true)
  })

  it('schützt auch die Bewerbungen einer Person mit Einwilligung', async () => {
    // Ohne diesen Schutz wäre die Einwilligung wertlos: Die Person bliebe
    // stehen, ihre Unterlagen wären aber gelöscht.
    await stelleFristenEin()
    await legeAn({ nachname: 'Poolvoll', abgeschlossenVorMonaten: 24, einwilligung: true })

    const stand = await holeStand()
    expect(stand.bewerbungen.faellig).toBe(0)

    const bericht = await loescheFaellige(null)
    expect(bericht.bewerbungen).toBe(0)
    expect(await prisma.application.count()).toBe(1)
  })
})
