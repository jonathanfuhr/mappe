import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../db'
import { mailSchema } from '../settings/schema'
import { fileExists } from '../lib/storage'
import { importiereMails } from './ingest'
import type { RohMail } from './types'

/**
 * Import-Strecke von der rohen Nachricht bis zum fertigen Datensatz.
 * Läuft gegen eine echte Datenbank – der Weg über Prisma ist genau der Teil,
 * den ein Mock nicht prüfen würde.
 */

const EINSTELLUNGEN = mailSchema.parse({
  adapter: 'graph',
  weiterleitungsAdressen: ['info@firma.de'],
})

let zaehler = 0
function rohMail(kopfzeilen: Record<string, string>, koerper: string, teile?: string[]): RohMail {
  const zeilen = Object.entries(kopfzeilen).map(([k, v]) => `${k}: ${v}`)
  const inhalt = teile ? teile.join('\r\n') : koerper
  return {
    providerMessageId: `test-${++zaehler}-${Date.now()}`,
    mime: Buffer.from(`${zeilen.join('\r\n')}\r\n\r\n${inhalt}`, 'utf8'),
  }
}

/** Ein echtes PDF – so wird auch die Textextraktion mitgeprüft. */
async function bauPdf(zeilen: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const schrift = await pdf.embedFont(StandardFonts.Helvetica)
  const seite = pdf.addPage([595, 842])
  zeilen.forEach((zeile, i) => {
    seite.drawText(zeile, { x: 60, y: 760 - i * 20, size: 11, font: schrift })
  })
  return Buffer.from(await pdf.save())
}

function mitAnhang(
  kopfzeilen: Record<string, string>,
  text: string,
  anhang: { name: string; typ: string; inhalt: Buffer },
): RohMail {
  const grenze = 'grenze12345'
  const zeilen = [
    ...Object.entries({ ...kopfzeilen, 'Content-Type': `multipart/mixed; boundary="${grenze}"` }).map(
      ([k, v]) => `${k}: ${v}`,
    ),
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '',
    `--${grenze}`,
    `Content-Type: ${anhang.typ}; name="${anhang.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${anhang.name}"`,
    '',
    anhang.inhalt.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    '',
    `--${grenze}--`,
    '',
  ]
  return { providerMessageId: `test-${++zaehler}-${Date.now()}`, mime: Buffer.from(zeilen.join('\r\n'), 'utf8') }
}

async function raeumeAuf(): Promise<void> {
  await prisma.extractionSuggestion.deleteMany()
  await prisma.mailAttachment.deleteMany()
  await prisma.mailMessage.deleteMany()
  await prisma.document.deleteMany()
  await prisma.application.deleteMany()
  await prisma.candidate.deleteMany()
  await prisma.job.deleteMany()
}

beforeEach(raeumeAuf)
afterAll(async () => {
  await raeumeAuf()
  await prisma.$disconnect()
})

describe('Import einer direkten Bewerbung', () => {
  it('legt Bewerber, Bewerbung, Mail und Vorschlag an', async () => {
    await prisma.job.create({
      data: { title: 'Mediengestalter', reference: 'MG-2025-04', keywords: ['gestaltung'] },
    })

    const bericht = await importiereMails(
      [
        rohMail(
          {
            From: 'Max Mustermann <max.mustermann@example.com>',
            To: 'bewerbung@firma.de',
            Subject: 'Bewerbung als Mediengestalter (MG-2025-04)',
            'Message-ID': '<direkt-1@example.com>',
          },
          [
            'Sehr geehrte Damen und Herren,',
            '',
            'hiermit bewerbe ich mich auf die ausgeschriebene Stelle.',
            '',
            'Musterstraße 12a',
            '04103 Leipzig',
            'Telefon: 0171 1234567',
            '',
            'Mit freundlichen Grüßen',
            'Max Mustermann',
          ].join('\r\n'),
        ),
      ],
      EINSTELLUNGEN,
    )

    expect(bericht.neueBewerbungen).toBe(1)
    expect(bericht.fehler).toHaveLength(0)

    const bewerber = await prisma.candidate.findFirst()
    expect(bewerber).toMatchObject({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max.mustermann@example.com',
      phone: '+491711234567',
      postalCode: '04103',
      city: 'Leipzig',
      street: 'Musterstraße 12a',
    })

    const bewerbung = await prisma.application.findFirst({ include: { job: true } })
    expect(bewerbung?.job?.reference).toBe('MG-2025-04')
    expect(bewerbung?.source).toBe('EMAIL')
    expect(bewerbung?.needsReview).toBe(true)

    const mail = await prisma.mailMessage.findFirst()
    expect(mail?.direction).toBe('EINGEHEND')
    expect(mail?.forwarded).toBe(false)
    expect(mail?.emlPath).toBeTruthy()
    // Das Original muss unverändert auf der Platte liegen.
    expect(await fileExists(mail!.emlPath!)).toBe(true)

    const vorschlag = await prisma.extractionSuggestion.findFirst()
    expect(vorschlag?.source).toBe('REGELN')
    expect((vorschlag?.payload as { stelle: { sicherheit: number } }).stelle.sicherheit).toBeGreaterThan(0.9)
  })
})

describe('Weiterleitung über das Info-Postfach', () => {
  it('übernimmt den ursprünglichen Absender statt der Von-Zeile', async () => {
    await importiereMails(
      [
        rohMail(
          {
            From: 'Info Postfach <info@firma.de>',
            To: 'bewerbung@firma.de',
            Subject: 'WG: Bewerbung',
            'Message-ID': '<wg-1@firma.de>',
          },
          [
            'FYI',
            '',
            '-----Ursprüngliche Nachricht-----',
            'Von: Anna Schmidt <anna.schmidt@example.org>',
            'Gesendet: Montag, 14. Juli 2025 09:12',
            'An: info@firma.de',
            'Betreff: Bewerbung',
            '',
            'Sehr geehrte Damen und Herren,',
          ].join('\r\n'),
        ),
      ],
      EINSTELLUNGEN,
    )

    const bewerber = await prisma.candidate.findFirst()
    // Entscheidend: nicht info@firma.de.
    expect(bewerber?.email).toBe('anna.schmidt@example.org')
    expect(bewerber?.lastName).toBe('Schmidt')

    const mail = await prisma.mailMessage.findFirst()
    expect(mail?.forwarded).toBe(true)
    expect(mail?.fromEmail).toBe('info@firma.de')
    expect(mail?.originalFromEmail).toBe('anna.schmidt@example.org')
  })
})

describe('Anhänge', () => {
  it('legt PDFs als Dokument an und liest ihren Text aus', async () => {
    const pdf = await bauPdf([
      'Lebenslauf',
      'Anna Beispiel',
      'anna.beispiel@example.com',
      'Telefon 0341 9876543',
    ])

    await importiereMails(
      [
        mitAnhang(
          {
            From: 'Anna Beispiel <anna.beispiel@example.com>',
            To: 'bewerbung@firma.de',
            Subject: 'Bewerbung',
            'Message-ID': '<anhang-1@example.com>',
          },
          'Anbei meine Unterlagen.',
          { name: 'lebenslauf.pdf', typ: 'application/pdf', inhalt: pdf },
        ),
      ],
      EINSTELLUNGEN,
    )

    const dokument = await prisma.document.findFirst()
    expect(dokument?.filename).toBe('lebenslauf.pdf')
    // Vor dem Auftrennen ist jede Datei das Original.
    expect(dokument?.category).toBe('ORIGINAL')
    expect(dokument?.pageCount).toBe(1)
    expect(dokument?.extractedText).toContain('Anna Beispiel')
    expect(await fileExists(dokument!.storagePath)).toBe(true)

    const anhang = await prisma.mailAttachment.findFirst()
    expect(anhang?.documentId).toBe(dokument?.id)

    // Der Text aus dem PDF muss in die Erkennung eingeflossen sein.
    const bewerber = await prisma.candidate.findFirst()
    expect(bewerber?.phone).toBe('+493419876543')
  })
})

describe('Doppelte und fortgesetzte Nachrichten', () => {
  it('importiert dieselbe Nachricht kein zweites Mal', async () => {
    const nachricht = rohMail(
      { From: 'max@example.com', Subject: 'Bewerbung', 'Message-ID': '<doppelt@example.com>' },
      'Text',
    )

    await importiereMails([nachricht], EINSTELLUNGEN)
    const zweiterLauf = await importiereMails([nachricht], EINSTELLUNGEN)

    expect(zweiterLauf.uebersprungen).toBe(1)
    expect(await prisma.application.count()).toBe(1)
  })

  it('erkennt dieselbe Nachricht auch an einer neuen Anbieter-Kennung wieder', async () => {
    const kopf = { From: 'max@example.com', Subject: 'Bewerbung', 'Message-ID': '<gleich@example.com>' }
    await importiereMails([rohMail(kopf, 'Text')], EINSTELLUNGEN)
    // Gleiche Message-ID, andere providerMessageId – etwa nach einem
    // Zurücksetzen des Delta-Stands.
    const zweiterLauf = await importiereMails([rohMail(kopf, 'Text')], EINSTELLUNGEN)

    expect(zweiterLauf.uebersprungen).toBe(1)
    expect(await prisma.application.count()).toBe(1)
  })

  it('hängt eine Antwort an die bestehende Bewerbung statt eine zweite anzulegen', async () => {
    await importiereMails(
      [
        rohMail(
          { From: 'Max Mustermann <max@example.com>', Subject: 'Bewerbung als Bürokraft', 'Message-ID': '<a@x>' },
          'Anschreiben',
        ),
      ],
      EINSTELLUNGEN,
    )

    const nachtrag = await importiereMails(
      [
        rohMail(
          {
            From: 'Max Mustermann <max@example.com>',
            Subject: 'AW: Bewerbung als Bürokraft',
            'Message-ID': '<b@x>',
          },
          'Hier noch mein Zeugnis.',
        ),
      ],
      EINSTELLUNGEN,
    )

    expect(nachtrag.angehaengteAntworten).toBe(1)
    expect(await prisma.application.count()).toBe(1)
    expect(await prisma.mailMessage.count()).toBe(2)
  })

  it('legt für eine zweite Bewerbung desselben Menschen keinen neuen Bewerber an', async () => {
    await importiereMails(
      [rohMail({ From: 'Max Mustermann <max@example.com>', Subject: 'Bewerbung Bürokraft', 'Message-ID': '<c@x>' }, 'Text')],
      EINSTELLUNGEN,
    )
    await importiereMails(
      [rohMail({ From: 'Max Mustermann <max@example.com>', Subject: 'Bewerbung Lagerist', 'Message-ID': '<d@x>' }, 'Text')],
      EINSTELLUNGEN,
    )

    expect(await prisma.candidate.count()).toBe(1)
    expect(await prisma.application.count()).toBe(2)
  })
})

describe('Portal- und Formularmails', () => {
  it('erkennt eine Website-Formularmail und deren Quelle', async () => {
    await importiereMails(
      [
        rohMail(
          { From: 'website@firma.de', Subject: 'Neue Bewerbung über das Formular', 'Message-ID': '<f@x>' },
          [
            'Name: Peter Klein',
            'E-Mail: peter.klein@example.net',
            'Telefon: 0341 1234567',
            'Stelle: Bürokraft',
            'Nachricht: Ich bewerbe mich hiermit.',
          ].join('\r\n'),
        ),
      ],
      EINSTELLUNGEN,
    )

    const bewerbung = await prisma.application.findFirst()
    expect(bewerbung?.source).toBe('WEBSITE_FORMULAR')

    const bewerber = await prisma.candidate.findFirst()
    // Die Adresse aus dem Formular zählt, nicht die des Webservers.
    expect(bewerber?.email).toBe('peter.klein@example.net')
    expect(bewerber?.lastName).toBe('Klein')
  })

  it('erkennt eine LinkedIn-Benachrichtigung', async () => {
    await importiereMails(
      [
        rohMail(
          {
            From: 'LinkedIn <jobs-noreply@linkedin.com>',
            Subject: 'Neue Bewerbung von Lisa Bauer für Bürokraft bei Firma',
            'Message-ID': '<li@x>',
          },
          'Neue Bewerbung von Lisa Bauer\r\nE-Mail: lisa.bauer@example.com',
        ),
      ],
      EINSTELLUNGEN,
    )

    const bewerbung = await prisma.application.findFirst()
    expect(bewerbung?.source).toBe('LINKEDIN')
    const bewerber = await prisma.candidate.findFirst()
    expect(bewerber?.lastName).toBe('Bauer')
    expect(bewerber?.email).toBe('lisa.bauer@example.com')
  })
})

describe('Initiativbewerbung', () => {
  it('ordnet sie der Initiativ-Stelle zu', async () => {
    await prisma.job.create({ data: { title: 'Initiativbewerbung', speculative: true } })

    await importiereMails(
      [rohMail({ From: 'max@example.com', Subject: 'Initiativbewerbung', 'Message-ID': '<i@x>' }, 'Text')],
      EINSTELLUNGEN,
    )

    const bewerbung = await prisma.application.findFirst({ include: { job: true } })
    expect(bewerbung?.speculative).toBe(true)
    expect(bewerbung?.job?.title).toBe('Initiativbewerbung')
  })
})

describe('Robustheit', () => {
  it('lässt eine kaputte Nachricht den Lauf nicht abbrechen', async () => {
    const kaputt: RohMail = { providerMessageId: 'kaputt-1', mime: Buffer.from([0xff, 0xfe, 0x00]) }
    const gut = rohMail({ From: 'ok@example.com', Subject: 'Bewerbung', 'Message-ID': '<ok@x>' }, 'Text')

    const bericht = await importiereMails([kaputt, gut], EINSTELLUNGEN)

    // Auch aus der kaputten Nachricht wird ein Datensatz – lieber ein leerer
    // Eintrag zum Nacharbeiten als eine verlorene Bewerbung.
    expect(bericht.gepruefte).toBe(2)
    expect(await prisma.application.count()).toBeGreaterThanOrEqual(1)
    const ok = await prisma.candidate.findFirst({ where: { email: 'ok@example.com' } })
    expect(ok).not.toBeNull()
  })
})
