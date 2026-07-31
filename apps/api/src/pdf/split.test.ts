import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { fileExists, writeFileTo } from '../lib/storage'
import { fasseZuBereichen, schlageKategorienVor } from './heuristik'
import { nimmSplitZurueck, trenneAuf } from './split'
import { extrahiereText } from './text'

/** Baut ein mehrseitiges PDF; jede Zeilengruppe wird eine Seite. */
async function bauPdf(seiten: string[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const schrift = await pdf.embedFont(StandardFonts.Helvetica)
  for (const zeilen of seiten) {
    const seite = pdf.addPage([595, 842])
    zeilen.forEach((zeile, i) =>
      seite.drawText(zeile, { x: 60, y: 770 - i * 22, size: 12, font: schrift }),
    )
  }
  return Buffer.from(await pdf.save())
}

/** Das typische Kombi-PDF: Anschreiben, zweiseitiger Lebenslauf, drei Zeugnisseiten. */
const KOMBI: string[][] = [
  ['Bewerbung als Mediengestalter', 'Sehr geehrte Damen und Herren,', 'hiermit bewerbe ich mich.'],
  ['Lebenslauf', 'Max Mustermann', 'Berufserfahrung'],
  ['2018 - 2021 Ausbildung', 'Agentur Nord', 'Weitere Stationen'],
  ['Arbeitszeugnis', 'Herr Mustermann war taetig als', 'Gesamtnote: sehr gut'],
  ['Fortsetzung des Zeugnisses', 'Er erfuellte die Aufgaben', 'stets zu unserer Zufriedenheit'],
  ['Zertifikat', 'Teilnahmebescheinigung Adobe InDesign', 'Dauer: 3 Tage'],
]

async function legeDokumentAn(inhalt: Buffer, dateiname = 'bewerbung-komplett.pdf') {
  const bewerber = await prisma.candidate.create({ data: { lastName: 'Mustermann' } })
  const bewerbung = await prisma.application.create({ data: { candidateId: bewerber.id } })
  const ablage = await writeFileTo('dokumente', dateiname, inhalt)
  return prisma.document.create({
    data: {
      applicationId: bewerbung.id,
      category: 'ORIGINAL',
      filename: dateiname,
      storagePath: ablage.storagePath,
      mimeType: 'application/pdf',
      size: ablage.size,
      pageCount: 6,
    },
  })
}

async function raeumeAuf(): Promise<void> {
  await prisma.document.deleteMany()
  await prisma.application.deleteMany()
  await prisma.candidate.deleteMany()
}

beforeEach(raeumeAuf)
afterAll(async () => {
  await raeumeAuf()
  await prisma.$disconnect()
})

describe('Stichwort-Heuristik', () => {
  it('erkennt die Anfänge der Teildokumente', async () => {
    const inhalt = await bauPdf(KOMBI)
    const text = await extrahiereText(inhalt)
    const vorschlag = schlageKategorienVor(text.seiten)

    expect(vorschlag.map((v) => v.kategorie)).toEqual([
      'ANSCHREIBEN',
      'LEBENSLAUF',
      'LEBENSLAUF',
      'ZEUGNISSE',
      'ZEUGNISSE',
      'ZEUGNISSE',
    ])
  })

  it('schreibt die Kategorie über Folgeseiten fort', async () => {
    const inhalt = await bauPdf(KOMBI)
    const text = await extrahiereText(inhalt)
    const vorschlag = schlageKategorienVor(text.seiten)

    // Seite 3 hat kein eigenes Stichwort und gehört zum Lebenslauf davor.
    expect(vorschlag[2].beginntNeuesDokument).toBe(false)
    expect(vorschlag[2].begruendung).toContain('Fortsetzung')
    // Seite 5 ist die Fortsetzung des Zeugnisses.
    expect(vorschlag[4].beginntNeuesDokument).toBe(false)
  })

  it('markiert Seiten ohne Text als vermutlichen Scan', async () => {
    const inhalt = await bauPdf([['Lebenslauf', 'Max Mustermann'], []])
    const text = await extrahiereText(inhalt)
    const vorschlag = schlageKategorienVor(text.seiten)

    expect(vorschlag[1].begruendung).toContain('Scan')
    // Trotzdem der laufenden Kategorie zugeschlagen, nicht auf „Andere" gesetzt.
    expect(vorschlag[1].kategorie).toBe('LEBENSLAUF')
  })
})

describe('Bereiche bilden', () => {
  it('fasst zusammenhängende Seiten gleicher Kategorie zusammen', () => {
    const bereiche = fasseZuBereichen([
      { seite: 1, kategorie: 'ANSCHREIBEN' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
      { seite: 3, kategorie: 'LEBENSLAUF' },
      { seite: 4, kategorie: 'ZEUGNISSE' },
    ])

    expect(bereiche).toEqual([
      { kategorie: 'ANSCHREIBEN', seiten: [1] },
      { kategorie: 'LEBENSLAUF', seiten: [2, 3] },
      { kategorie: 'ZEUGNISSE', seiten: [4] },
    ])
  })

  it('trennt gleiche Kategorien mit einer Lücke dazwischen', () => {
    // Zwei getrennte Zeugnisse dürfen nicht zu einer Datei verschmelzen.
    const bereiche = fasseZuBereichen([
      { seite: 1, kategorie: 'ZEUGNISSE' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
      { seite: 3, kategorie: 'ZEUGNISSE' },
    ])

    expect(bereiche).toHaveLength(3)
    expect(bereiche[0].seiten).toEqual([1])
    expect(bereiche[2].seiten).toEqual([3])
  })
})

describe('Auftrennen', () => {
  it('erzeugt Teil-PDFs und lässt das Original unangetastet', async () => {
    const inhalt = await bauPdf(KOMBI)
    const dokument = await legeDokumentAn(inhalt)

    const ergebnis = await trenneAuf(dokument.id, [
      { seite: 1, kategorie: 'ANSCHREIBEN' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
      { seite: 3, kategorie: 'LEBENSLAUF' },
      { seite: 4, kategorie: 'ZEUGNISSE' },
      { seite: 5, kategorie: 'ZEUGNISSE' },
      { seite: 6, kategorie: 'ZEUGNISSE' },
    ])

    expect(ergebnis.erzeugt).toHaveLength(3)
    expect(ergebnis.erzeugt.map((e) => e.seiten)).toEqual([[1], [2, 3], [4, 5, 6]])

    // Mehrseitige Teile bleiben zusammen.
    const lebenslauf = await prisma.document.findFirst({ where: { category: 'LEBENSLAUF' } })
    expect(lebenslauf?.pageCount).toBe(2)
    expect(lebenslauf?.parentId).toBe(dokument.id)
    expect(lebenslauf?.sourcePages).toEqual([2, 3])
    expect(lebenslauf?.extractedText).toContain('Lebenslauf')

    // Das Original liegt unverändert daneben.
    const original = await prisma.document.findUniqueOrThrow({ where: { id: dokument.id } })
    expect(original.category).toBe('ORIGINAL')
    expect(original.pageCount).toBe(6)
    expect(await fileExists(original.storagePath)).toBe(true)
  })

  it('nummeriert mehrere Teile derselben Kategorie durch', async () => {
    const inhalt = await bauPdf(KOMBI)
    const dokument = await legeDokumentAn(inhalt)

    const ergebnis = await trenneAuf(dokument.id, [
      { seite: 1, kategorie: 'ZEUGNISSE' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
      { seite: 3, kategorie: 'ZEUGNISSE' },
    ])

    const zeugnisse = ergebnis.erzeugt.filter((e) => e.kategorie === 'ZEUGNISSE')
    expect(zeugnisse).toHaveLength(2)
    expect(zeugnisse[0].dateiname).toContain('Zeugnis 1')
    expect(zeugnisse[1].dateiname).toContain('Zeugnis 2')
  })

  it('ersetzt beim erneuten Auftrennen die alten Teile statt sie zu ergänzen', async () => {
    const inhalt = await bauPdf(KOMBI)
    const dokument = await legeDokumentAn(inhalt)

    await trenneAuf(dokument.id, [
      { seite: 1, kategorie: 'ANSCHREIBEN' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
    ])
    const ersteTeile = await prisma.document.findMany({ where: { parentId: dokument.id } })

    const zweiter = await trenneAuf(dokument.id, [
      { seite: 1, kategorie: 'ANSCHREIBEN' },
      { seite: 2, kategorie: 'ZEUGNISSE' },
    ])

    expect(zweiter.ersetzt).toBe(2)
    const teile = await prisma.document.findMany({ where: { parentId: dokument.id } })
    expect(teile).toHaveLength(2)
    expect(teile.map((t) => t.category).sort()).toEqual(['ANSCHREIBEN', 'ZEUGNISSE'])

    // Die Dateien der ersetzten Teile sind auch von der Platte verschwunden.
    for (const alt of ersteTeile) {
      expect(await fileExists(alt.storagePath)).toBe(false)
    }
  })

  it('nimmt eine Auftrennung vollständig zurück', async () => {
    const inhalt = await bauPdf(KOMBI)
    const dokument = await legeDokumentAn(inhalt)
    await trenneAuf(dokument.id, [
      { seite: 1, kategorie: 'ANSCHREIBEN' },
      { seite: 2, kategorie: 'LEBENSLAUF' },
    ])

    expect(await nimmSplitZurueck(dokument.id)).toBe(2)
    expect(await prisma.document.count({ where: { parentId: dokument.id } })).toBe(0)
    // Das Original ist noch da.
    expect(await prisma.document.count({ where: { id: dokument.id } })).toBe(1)
  })

  it('weist Seitenzahlen außerhalb des Dokuments ab', async () => {
    const inhalt = await bauPdf(KOMBI)
    const dokument = await legeDokumentAn(inhalt)

    await expect(trenneAuf(dokument.id, [{ seite: 99, kategorie: 'ANDERE' }])).rejects.toThrow(
      /keine Seite zugeordnet/i,
    )
  })
})
