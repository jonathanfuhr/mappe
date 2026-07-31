import { describe, expect, it } from 'vitest'
import {
  erkenneAusText,
  findeAdresse,
  findeEmails,
  findeLinks,
  findeNameAusGruss,
  findeTelefon,
  normalisiereTelefon,
  zerlegeName,
} from './rules'

describe('E-Mail-Erkennung', () => {
  it('findet Adressen und wirft Automaten heraus', () => {
    const text = `
      Kontakt: max.mustermann@example.com
      Antworten Sie nicht an noreply@linkedin.com
      Zweitadresse: m.mustermann@web.de.
    `
    expect(findeEmails(text)).toEqual(['max.mustermann@example.com', 'm.mustermann@web.de'])
  })

  it('entfernt anhängende Satzzeichen', () => {
    expect(findeEmails('Schreiben Sie an anna@example.org,')).toEqual(['anna@example.org'])
  })
})

describe('Telefonerkennung', () => {
  it.each([
    ['+49 171 1234567', '+491711234567'],
    ['0171/1234567', '+491711234567'],
    ['(0341) 123 45 67', '+493411234567'],
    ['0049 30 1234567', '+49301234567'],
  ])('erkennt %s', (eingabe, erwartet) => {
    expect(findeTelefon(`Telefon: ${eingabe}`)).toBe(erwartet)
  })

  it('hält Jahreszahlen aus dem Lebenslauf heraus', () => {
    expect(findeTelefon('Ausbildung 2015 bis 2018 in Leipzig')).toBeUndefined()
  })

  it('lässt zu kurze Zahlenfolgen liegen', () => {
    expect(findeTelefon('Zimmer 0341')).toBeUndefined()
  })

  it('normalisiert die führende Null zur Landesvorwahl', () => {
    expect(normalisiereTelefon('0341 1234567')).toBe('+493411234567')
    expect(normalisiereTelefon('+41 44 1234567')).toBe('+41441234567')
  })
})

describe('Adresserkennung', () => {
  it('liest Straße, PLZ und Ort', () => {
    const treffer = findeAdresse('Musterstraße 12a\n04103 Leipzig\nDeutschland')
    expect(treffer).toEqual({ strasse: 'Musterstraße 12a', plz: '04103', ort: 'Leipzig' })
  })

  it('kommt mit abgekürzten Straßennamen zurecht', () => {
    expect(findeAdresse('Bahnhofstr. 7\n10115 Berlin').strasse).toBe('Bahnhofstr. 7')
  })

  it('liefert nichts, wenn keine Adresse dasteht', () => {
    expect(findeAdresse('Ich freue mich auf Ihre Rückmeldung.')).toEqual({})
  })
})

describe('Namenszerlegung', () => {
  it.each([
    ['Max Mustermann', { vorname: 'Max', nachname: 'Mustermann' }],
    ['Anna Maria Schmidt', { vorname: 'Anna Maria', nachname: 'Schmidt' }],
    ['Peter von Berg', { vorname: 'Peter', nachname: 'von Berg' }],
    ['Jan van der Meer', { vorname: 'Jan', nachname: 'van der Meer' }],
    ['Mustermann, Max', { vorname: 'Max', nachname: 'Mustermann' }],
  ])('zerlegt "%s"', (eingabe, erwartet) => {
    expect(zerlegeName(eingabe)).toMatchObject(erwartet)
  })

  it('trennt akademische Titel ab', () => {
    expect(zerlegeName('Dr. Anna Schmidt')).toEqual({
      titel: 'Dr.',
      vorname: 'Anna',
      nachname: 'Schmidt',
    })
  })

  it('behandelt einen einzelnen Namen als Nachnamen', () => {
    expect(zerlegeName('Mustermann')).toEqual({ titel: undefined, nachname: 'Mustermann' })
  })
})

describe('Name aus der Grußformel', () => {
  it('liest den Namen unter "Mit freundlichen Grüßen"', () => {
    const text = 'Ich freue mich auf ein Gespräch.\n\nMit freundlichen Grüßen\nMax Mustermann'
    expect(findeNameAusGruss(text)).toBe('Max Mustermann')
  })

  it('ignoriert Telefonnummern und Adressen unter der Grußformel', () => {
    expect(findeNameAusGruss('Viele Grüße\nmax@example.com')).toBeUndefined()
  })
})

describe('Links', () => {
  it('erkennt Portale und lässt Abmeldelinks weg', () => {
    const text =
      'Profil: https://www.linkedin.com/in/mustermann und https://example.com/unsubscribe?x=1'
    const links = findeLinks(text)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({ label: 'LinkedIn', url: 'https://www.linkedin.com/in/mustermann' })
  })
})

describe('Zusammenführung', () => {
  it('zieht die Absenderadresse der Textfundstelle vor', () => {
    const daten = erkenneAusText('Kontakt im Text: alt@example.com', {
      name: 'Max Mustermann',
      email: 'max@example.com',
    })
    expect(daten.email).toBe('max@example.com')
    expect(daten).toMatchObject({ vorname: 'Max', nachname: 'Mustermann' })
  })

  it('leitet den Namen notfalls aus der Adresse ab', () => {
    const daten = erkenneAusText('Sehr geehrte Damen und Herren', {
      email: 'anna.schmidt@example.com',
    })
    expect(daten).toMatchObject({ vorname: 'Anna', nachname: 'Schmidt' })
  })

  it('nimmt eine Portaladresse nicht als Bewerberadresse', () => {
    const daten = erkenneAusText('Neue Bewerbung', { email: 'jobs-noreply@linkedin.com' })
    expect(daten.email).toBeUndefined()
  })
})
