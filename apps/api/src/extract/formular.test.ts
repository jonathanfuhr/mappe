import { describe, expect, it } from 'vitest'
import { parseFormularMail } from './formular'
import { erkennePortal } from './portale'
import { ordneStelleZu } from './stellen'
import type { GeparsteMail } from '../mail/parse'
import type { Job } from '@prisma/client'

describe('Website-Formular', () => {
  it('liest ein vollständiges Formular aus', () => {
    const text = [
      'Name: Max Mustermann',
      'E-Mail: max@example.com',
      'Telefon: 0171 1234567',
      'Stelle: Mediengestalter (m/w/d)',
      'Nachricht: Ich bewerbe mich auf die ausgeschriebene Stelle.',
    ].join('\n')

    const ergebnis = parseFormularMail(text)

    expect(ergebnis.erkannt).toBe(true)
    expect(ergebnis.daten).toMatchObject({
      vorname: 'Max',
      nachname: 'Mustermann',
      email: 'max@example.com',
      telefon: '+491711234567',
    })
    expect(ergebnis.stelle).toBe('Mediengestalter (m/w/d)')
    expect(ergebnis.nachricht).toContain('ausgeschriebene Stelle')
  })

  it('hängt Folgezeilen an das zuletzt erkannte Feld', () => {
    const text = [
      'Vorname: Anna',
      'Nachname: Schmidt',
      'E-Mail: anna@example.org',
      'Nachricht: Guten Tag,',
      'ich interessiere mich für die Stelle.',
      'Viele Grüße',
    ].join('\n')

    const ergebnis = parseFormularMail(text)
    expect(ergebnis.nachricht).toContain('ich interessiere mich')
    expect(ergebnis.nachricht).toContain('Viele Grüße')
  })

  it('hält ein normales Anschreiben für kein Formular', () => {
    const text = [
      'Sehr geehrte Damen und Herren,',
      '',
      'hiermit bewerbe ich mich: Ich bringe folgende Erfahrung mit.',
      '',
      'Mit freundlichen Grüßen',
      'Max Mustermann',
    ].join('\n')

    expect(parseFormularMail(text).erkannt).toBe(false)
  })

  it('kommt mit englischen Feldnamen zurecht', () => {
    const text = ['Full name: Anna Schmidt', 'Email: anna@example.org', 'Phone: +49 30 1234567'].join('\n')
    const ergebnis = parseFormularMail(text)
    expect(ergebnis.erkannt).toBe(true)
    expect(ergebnis.daten.nachname).toBe('Schmidt')
  })
})

function bauMail(von: string, betreff: string, text: string): GeparsteMail {
  return {
    internetMessageId: null,
    conversationId: null,
    betreff,
    von: { name: '', email: von },
    an: [],
    kopie: [],
    textInhalt: text,
    htmlInhalt: null,
    eingegangenAm: new Date(),
    anhaenge: [],
    weiterleitung: { erkannt: false, urspruenglicherAbsender: null, quelle: 'kein' },
    kopfzeilen: {},
  }
}

describe('Portal-Parser', () => {
  it('liest eine LinkedIn-Benachrichtigung', () => {
    const mail = bauMail(
      'jobs-noreply@linkedin.com',
      'Neue Bewerbung von Max Mustermann für Mediengestalter bei Firma',
      'Neue Bewerbung von Max Mustermann\nE-Mail: max@example.com\nTelefon: 0171 1234567',
    )

    const ergebnis = erkennePortal(mail)
    expect(ergebnis?.quelle).toBe('LINKEDIN')
    expect(ergebnis?.erkannt).toBe(true)
    expect(ergebnis?.daten).toMatchObject({ vorname: 'Max', nachname: 'Mustermann', email: 'max@example.com' })
    expect(ergebnis?.stelle).toBe('Mediengestalter')
  })

  it('liest eine Indeed-Benachrichtigung', () => {
    const mail = bauMail(
      'noreply@indeed.com',
      'Anna Schmidt hat sich auf Bürokraft beworben',
      'Name: Anna Schmidt\nE-Mail: anna@example.org',
    )

    const ergebnis = erkennePortal(mail)
    expect(ergebnis?.quelle).toBe('INDEED')
    expect(ergebnis?.daten.nachname).toBe('Schmidt')
    expect(ergebnis?.daten.email).toBe('anna@example.org')
  })

  it('nimmt niemals die Portaladresse als Bewerberadresse', () => {
    const mail = bauMail(
      'jobs-noreply@linkedin.com',
      'Neue Bewerbung von Max Mustermann',
      'E-Mail: jobs-noreply@linkedin.com',
    )
    expect(erkennePortal(mail)?.daten.email).toBeUndefined()
  })

  it('greift bei einer normalen Mail nicht', () => {
    expect(erkennePortal(bauMail('max@example.com', 'Bewerbung', 'Text'))).toBeNull()
  })
})

function bauStelle(teil: Partial<Job> & { id: string; title: string }): Job {
  return {
    reference: null,
    location: null,
    department: null,
    employment: null,
    description: '',
    keywords: [],
    status: 'OFFEN',
    speculative: false,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...teil,
  } as Job
}

describe('Stellenzuordnung', () => {
  const stellen = [
    bauStelle({ id: 'a', title: 'Mediengestalter Digital und Print', reference: 'MG-2025-04' }),
    bauStelle({ id: 'b', title: 'Bürokraft', keywords: ['sekretariat', 'empfang'] }),
    bauStelle({ id: 'i', title: 'Initiativbewerbung', speculative: true }),
  ]

  it('trifft über die Referenznummer', () => {
    const treffer = ordneStelleZu('Bewerbung MG-2025-04', '', stellen)
    expect(treffer.jobId).toBe('a')
    expect(treffer.sicherheit).toBeGreaterThan(0.9)
  })

  it('trifft über den Stellentitel im Betreff', () => {
    expect(ordneStelleZu('Bewerbung als Bürokraft', '', stellen).jobId).toBe('b')
  })

  it('trifft über ein Stichwort', () => {
    expect(ordneStelleZu('Bewerbung', 'Ich möchte im Sekretariat arbeiten.', stellen).jobId).toBe('b')
  })

  it('erkennt eine Initiativbewerbung', () => {
    const treffer = ordneStelleZu('Initiativbewerbung', '', stellen)
    expect(treffer.initiativ).toBe(true)
    expect(treffer.jobId).toBe('i')
  })

  it('ordnet nichts zu, wenn nichts passt', () => {
    const treffer = ordneStelleZu('Anfrage', 'Guten Tag', stellen)
    expect(treffer.jobId).toBeNull()
    expect(treffer.sicherheit).toBe(0)
  })

  it('ordnet nichts zu, wenn zwei Stellen gleich gut passen', () => {
    // Beide Stellen hängen nur am selben Stichwort, kein Titel steht im Text.
    // Genau hier soll das Tool nachfragen statt zu raten.
    const gleichauf = [
      bauStelle({ id: 'x', title: 'Mediengestalter Digital', keywords: ['gestaltung'] }),
      bauStelle({ id: 'y', title: 'Grafiker', keywords: ['gestaltung'] }),
    ]
    const treffer = ordneStelleZu('Bewerbung', 'Ich arbeite seit Jahren in der Gestaltung.', gleichauf)
    expect(treffer.jobId).toBeNull()
    expect(treffer.begruendung).toContain('Mehrere Stellen')
  })

  it('zieht den genauen Titel dem längeren vor', () => {
    const zweiAehnliche = [
      bauStelle({ id: 'x', title: 'Bürokraft', keywords: ['empfang'] }),
      bauStelle({ id: 'y', title: 'Bürokraft Teilzeit', keywords: ['empfang'] }),
    ]
    expect(ordneStelleZu('Bewerbung als Bürokraft am Empfang', '', zweiAehnliche).jobId).toBe('x')
  })

  it('bevorzugt offene Stellen vor geschlossenen', () => {
    const gemischt = [
      bauStelle({ id: 'alt', title: 'Bürokraft', status: 'GESCHLOSSEN' }),
      bauStelle({ id: 'neu', title: 'Bürokraft', status: 'OFFEN' }),
    ]
    expect(ordneStelleZu('Bewerbung als Bürokraft', '', gemischt).jobId).toBe('neu')
  })
})
