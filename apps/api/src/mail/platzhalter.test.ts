import type { Application, Candidate, Job } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  baueWerte,
  formelleAnrede,
  glaetteText,
  rendereVorlage,
  setzeEin,
  STANDARD_PLATZHALTER,
} from './platzhalter'

function bewerber(teil: Partial<Candidate> = {}): Candidate {
  return {
    id: 'b1',
    salutation: 'FRAU',
    title: null,
    firstName: 'Sarah',
    lastName: 'Wendler',
    email: 'sarah.wendler@example.com',
    phone: '+493415566778',
    street: 'Bahnhofstraße 18',
    postalCode: '04103',
    city: 'Leipzig',
    country: null,
    links: [],
    birthDate: null,
    storageConsent: false,
    storageConsentDate: null,
    purgeDueAt: null,
    createdAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
    ...teil,
  } as Candidate
}

function quelle(teil: { bewerber?: Partial<Candidate>; stelle?: Partial<Job> | null } = {}) {
  const stelle =
    teil.stelle === null
      ? null
      : ({
          id: 'j1',
          title: 'Mediengestalter (m/w/d)',
          reference: 'MG-2025-04',
          location: 'Leipzig',
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
          ...teil.stelle,
        } as Job)

  const bewerbung = {
    id: 'a1',
    candidateId: 'b1',
    jobId: stelle?.id ?? null,
    speculative: false,
    source: 'EMAIL',
    stage: 'NEU',
    stageChangedAt: new Date(),
    boardOrder: 0,
    subject: null,
    summary: null,
    summaryModel: null,
    needsReview: true,
    reviewedAt: null,
    appliedAt: new Date('2026-07-14T09:12:00Z'),
    closedAt: null,
    purgeDueAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    candidate: bewerber(teil.bewerber),
    job: stelle,
  } as unknown as Parameters<typeof baueWerte>[0]['bewerbung']

  return {
    bewerbung,
    organisation: 'Muster GmbH',
    absenderName: 'Bewerbung Muster GmbH',
    bearbeiterName: 'Jonathan Fuhr',
  }
}

describe('Werte aus der Bewerbung', () => {
  it('füllt die Standard-Platzhalter', () => {
    const werte = baueWerte(quelle())
    expect(werte).toMatchObject({
      VORNAME: 'Sarah',
      NACHNAME: 'Wendler',
      NAME: 'Sarah Wendler',
      ANREDE: 'Frau',
      ANREDE_FORMELL: 'Sehr geehrte Frau Wendler',
      ANREDE_DU: 'Hallo Sarah',
      STELLE: 'Mediengestalter (m/w/d)',
      STELLE_REFERENZ: 'MG-2025-04',
      ORGANISATION: 'Muster GmbH',
      BEARBEITER: 'Jonathan Fuhr',
    })
  })

  it('setzt bei einer Initiativbewerbung die Stelle sinnvoll', () => {
    const q = quelle({ stelle: null })
    q.bewerbung.speculative = true
    expect(baueWerte(q).STELLE).toBe('Initiativbewerbung')
  })

  it('deckt jeden dokumentierten Platzhalter tatsächlich ab', () => {
    const werte = baueWerte(quelle())
    for (const platzhalter of STANDARD_PLATZHALTER) {
      expect(werte, `Platzhalter ${platzhalter.name} fehlt`).toHaveProperty(platzhalter.name)
    }
  })
})

describe('Formelle Anrede', () => {
  it.each([
    ['FRAU', 'Wendler', null, 'Sehr geehrte Frau Wendler'],
    ['HERR', 'Köhler', null, 'Sehr geehrter Herr Köhler'],
    ['FRAU', 'Schmidt', 'Dr.', 'Sehr geehrte Frau Dr. Schmidt'],
  ])('bildet %s %s', (anrede, nachname, titel, erwartet) => {
    expect(formelleAnrede(anrede as 'FRAU', nachname, titel)).toBe(erwartet)
  })

  it('weicht ohne bekannte Anrede auf die neutrale Form aus', () => {
    // Lieber unpersönlich als falsch – eine verkehrte Anrede in einer Absage
    // ist ein echter Fehlgriff.
    expect(formelleAnrede('KEINE', 'Wendler')).toBe('Sehr geehrte Damen und Herren')
    expect(formelleAnrede('DIVERS', 'Wendler')).toBe('Sehr geehrte Damen und Herren')
  })

  it('weicht auch ohne Nachnamen aus', () => {
    expect(formelleAnrede('FRAU', '')).toBe('Sehr geehrte Damen und Herren')
  })
})

describe('Platzhalter einsetzen', () => {
  const werte = { VORNAME: 'Sarah', NACHNAME: 'Wendler', TITEL: '' }

  it('ersetzt die einfache Schreibweise', () => {
    expect(setzeEin('Hallo $VORNAME!', werte).text).toBe('Hallo Sarah!')
  })

  it('ersetzt die geklammerte Schreibweise mit anschließendem Buchstaben', () => {
    expect(setzeEin('${VORNAME}s Unterlagen', werte).text).toBe('Sarahs Unterlagen')
  })

  it('meldet leere Platzhalter, ersetzt sie aber durch nichts', () => {
    const ergebnis = setzeEin('$TITEL $NACHNAME', werte)
    expect(ergebnis.text).toBe(' Wendler')
    expect(ergebnis.fehlende).toEqual(['TITEL'])
  })

  it('lässt unbekannte Platzhalter stehen und meldet sie', () => {
    // So fällt ein Tippfehler in der Vorschau auf, statt still zu verschwinden.
    const ergebnis = setzeEin('Hallo $VORNAEME', werte)
    expect(ergebnis.text).toBe('Hallo $VORNAEME')
    expect(ergebnis.unbekannte).toEqual(['VORNAEME'])
  })

  it('lässt Beträge und Kleinschreibung in Ruhe', () => {
    expect(setzeEin('Kosten: 50$ und $abc', werte).text).toBe('Kosten: 50$ und $abc')
  })
})

describe('Text glätten', () => {
  it('räumt die Lücken leerer Platzhalter auf', () => {
    expect(glaetteText('Sehr geehrte  Frau  Wendler ,\n\n\n\nText')).toBe(
      'Sehr geehrte Frau Wendler,\n\nText',
    )
  })
})

describe('Vorlage rendern', () => {
  it('setzt Betreff und Text und hängt die Signatur an', () => {
    const werte = baueWerte(quelle())
    const ergebnis = rendereVorlage(
      { subject: 'Ihre Bewerbung als $STELLE', body: '$ANREDE_FORMELL,\n\nvielen Dank.' },
      werte,
      'Muster GmbH · Musterweg 1 · 04103 Leipzig',
    )

    expect(ergebnis.betreff).toBe('Ihre Bewerbung als Mediengestalter (m/w/d)')
    expect(ergebnis.text).toBe(
      'Sehr geehrte Frau Wendler,\n\nvielen Dank.\n\nMuster GmbH · Musterweg 1 · 04103 Leipzig',
    )
    expect(ergebnis.unbekannte).toEqual([])
  })

  it('hält den Betreff einzeilig', () => {
    const ergebnis = rendereVorlage({ subject: 'Betreff\nmit Umbruch', body: 'Text' }, {})
    expect(ergebnis.betreff).toBe('Betreff mit Umbruch')
  })

  it('meldet fehlende Werte für die Warnung in der Oberfläche', () => {
    const werte = baueWerte(quelle({ bewerber: { firstName: '', phone: null } }))
    const ergebnis = rendereVorlage({ subject: 'Test', body: 'Hallo $VORNAME, $TELEFON' }, werte)
    expect(ergebnis.fehlende).toContain('VORNAME')
    expect(ergebnis.fehlende).toContain('TELEFON')
  })

  it('rendert die mitgelieferte Absage ohne offene Platzhalter', async () => {
    const { findeAuslieferungsstand } = await import('../seed/vorlagen')
    const absage = findeAuslieferungsstand('ABSAGE', 'SIE')!
    const ergebnis = rendereVorlage(absage, baueWerte(quelle()))

    expect(ergebnis.unbekannte).toEqual([])
    expect(ergebnis.fehlende).toEqual([])
    expect(ergebnis.text).toContain('Sehr geehrte Frau Wendler')
    // Keine Begründung – das ist bei einer Absage nach AGG die sichere Form.
    expect(ergebnis.text).not.toMatch(/weil|aufgrund|da Sie/i)
  })

  it('rendert jede mitgelieferte Vorlage ohne unbekannte Platzhalter', async () => {
    const { findeAuslieferungsstand } = await import('../seed/vorlagen')
    const arten = [
      'EINGANGSBESTAETIGUNG',
      'EINLADUNG',
      'ZUSAGE',
      'ABSAGE',
      'INITIATIV_ABSAGE',
      'NACHFRAGE',
    ] as const

    for (const art of arten) {
      for (const ton of ['DU', 'SIE'] as const) {
        const vorlage = findeAuslieferungsstand(art, ton)
        expect(vorlage, `${art}/${ton} fehlt`).toBeDefined()
        const ergebnis = rendereVorlage(vorlage!, baueWerte(quelle()))
        expect(ergebnis.unbekannte, `${art}/${ton}`).toEqual([])
      }
    }
  })
})
