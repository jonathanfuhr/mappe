import { describe, expect, it } from 'vitest'
import { absenderAusInlineWeiterleitung, adresseAusText, bildeVerlaufsKennung, parseMime } from './parse'

/** Baut eine einfache MIME-Nachricht aus Kopfzeilen und Textkörper. */
function mime(kopfzeilen: Record<string, string>, koerper: string): Buffer {
  const zeilen = Object.entries(kopfzeilen).map(([k, v]) => `${k}: ${v}`)
  return Buffer.from(`${zeilen.join('\r\n')}\r\n\r\n${koerper}`, 'utf8')
}

const VERTEILER = ['info@firma.de']

describe('Grundlegendes Parsen', () => {
  it('liest Absender, Empfänger, Betreff und Text', async () => {
    const nachricht = mime(
      {
        From: 'Max Mustermann <max@example.com>',
        To: 'Bewerbung <bewerbung@firma.de>',
        Subject: 'Bewerbung als Mediengestalter',
        'Message-ID': '<abc123@example.com>',
        Date: 'Mon, 14 Jul 2025 09:12:00 +0200',
      },
      'Sehr geehrte Damen und Herren,\r\n\r\nanbei meine Unterlagen.\r\n',
    )

    const geparst = await parseMime(nachricht, VERTEILER)

    expect(geparst.von).toEqual({ name: 'Max Mustermann', email: 'max@example.com' })
    expect(geparst.an[0].email).toBe('bewerbung@firma.de')
    expect(geparst.betreff).toBe('Bewerbung als Mediengestalter')
    expect(geparst.internetMessageId).toBe('<abc123@example.com>')
    expect(geparst.textInhalt).toContain('anbei meine Unterlagen')
    expect(geparst.weiterleitung.erkannt).toBe(false)
  })

  it('entschlüsselt Umlaute in kodierten Betreffzeilen', async () => {
    const nachricht = mime(
      {
        From: 'anna@example.com',
        Subject: '=?UTF-8?Q?Bewerbung_f=C3=BCr_die_Stelle_B=C3=BCrokraft?=',
      },
      'Text',
    )
    const geparst = await parseMime(nachricht)
    expect(geparst.betreff).toBe('Bewerbung für die Stelle Bürokraft')
  })
})

describe('Weiterleitungs-Erkennung', () => {
  it('erkennt den Absender aus einem eingebetteten Outlook-Vorspann', async () => {
    const nachricht = mime(
      {
        From: 'Info Postfach <info@firma.de>',
        To: 'bewerbung@firma.de',
        Subject: 'WG: Bewerbung als Mediengestalter',
      },
      [
        'FYI',
        '',
        '-----Ursprüngliche Nachricht-----',
        'Von: Max Mustermann <max@example.com>',
        'Gesendet: Montag, 14. Juli 2025 09:12',
        'An: info@firma.de',
        'Betreff: Bewerbung als Mediengestalter',
        '',
        'Sehr geehrte Damen und Herren,',
      ].join('\r\n'),
    )

    const geparst = await parseMime(nachricht, VERTEILER)

    expect(geparst.weiterleitung.erkannt).toBe(true)
    expect(geparst.weiterleitung.quelle).toBe('inline-text')
    expect(geparst.weiterleitung.urspruenglicherAbsender?.email).toBe('max@example.com')
    expect(geparst.weiterleitung.urspruenglicherAbsender?.name).toBe('Max Mustermann')
  })

  it('erkennt den englischen Gmail-Vorspann', async () => {
    const nachricht = mime(
      { From: 'info@firma.de', Subject: 'Fwd: Application' },
      [
        '---------- Forwarded message ---------',
        'From: Anna Schmidt <anna.schmidt@example.org>',
        'Date: Mon, 14 Jul 2025 at 09:12',
        'Subject: Application',
        '',
        'Dear Sir or Madam,',
      ].join('\r\n'),
    )

    const geparst = await parseMime(nachricht, VERTEILER)
    expect(geparst.weiterleitung.urspruenglicherAbsender?.email).toBe('anna.schmidt@example.org')
  })

  it('zieht den Absender aus einer als Anlage weitergeleiteten Nachricht', async () => {
    const original = [
      'From: Peter Klein <peter.klein@example.net>',
      'To: info@firma.de',
      'Subject: Bewerbung',
      '',
      'Mein Anschreiben.',
    ].join('\r\n')

    const nachricht = Buffer.from(
      [
        'From: Info Postfach <info@firma.de>',
        'To: bewerbung@firma.de',
        'Subject: WG: Bewerbung',
        'Content-Type: multipart/mixed; boundary="grenze"',
        '',
        '--grenze',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Siehe Anhang.',
        '',
        '--grenze',
        'Content-Type: message/rfc822',
        'Content-Disposition: attachment; filename="bewerbung.eml"',
        '',
        original,
        '',
        '--grenze--',
        '',
      ].join('\r\n'),
      'utf8',
    )

    const geparst = await parseMime(nachricht, VERTEILER)

    expect(geparst.weiterleitung.erkannt).toBe(true)
    expect(geparst.weiterleitung.quelle).toBe('angehaengte-nachricht')
    expect(geparst.weiterleitung.urspruenglicherAbsender?.email).toBe('peter.klein@example.net')
  })

  it('wertet die Resent-From-Kopfzeile aus', async () => {
    const nachricht = mime(
      {
        From: 'info@firma.de',
        'Resent-From': 'Lisa Bauer <lisa.bauer@example.com>',
        Subject: 'Bewerbung',
      },
      'Anschreiben.',
    )

    const geparst = await parseMime(nachricht, VERTEILER)
    expect(geparst.weiterleitung.quelle).toBe('kopfzeile')
    expect(geparst.weiterleitung.urspruenglicherAbsender?.email).toBe('lisa.bauer@example.com')
  })

  it('lässt eine Umleitung unangetastet – der Absender steht dort schon richtig', async () => {
    // Exchange-Regel „Umleiten": das From bleibt der Bewerber.
    const nachricht = mime(
      { From: 'Max Mustermann <max@example.com>', To: 'info@firma.de', Subject: 'Bewerbung' },
      'Anschreiben.',
    )

    const geparst = await parseMime(nachricht, VERTEILER)
    expect(geparst.weiterleitung.erkannt).toBe(false)
    expect(geparst.von.email).toBe('max@example.com')
  })

  it('greift nicht bei Mails, die nicht über den Verteiler kamen', async () => {
    // Direkt an das Bewerbungspostfach – ein zitierter Mailverkehr im Text
    // darf hier nicht als Weiterleitung durchgehen.
    const nachricht = mime(
      { From: 'Max Mustermann <max@example.com>', Subject: 'Re: Rückfrage' },
      ['Danke!', '', 'Von: Personalabteilung <hr@firma.de>', 'Betreff: Rückfrage'].join('\r\n'),
    )

    const geparst = await parseMime(nachricht, VERTEILER)
    expect(geparst.weiterleitung.erkannt).toBe(false)
  })

  it('wertet Reply-To nur bei einer Verteiler-Mail aus', async () => {
    const ueberVerteiler = mime(
      { From: 'info@firma.de', 'Reply-To': 'bewerber@example.com', Subject: 'Bewerbung' },
      'Text',
    )
    expect((await parseMime(ueberVerteiler, VERTEILER)).weiterleitung.urspruenglicherAbsender?.email).toBe(
      'bewerber@example.com',
    )

    const direkt = mime(
      { From: 'newsletter@example.com', 'Reply-To': 'antwort@example.com', Subject: 'Bewerbung' },
      'Text',
    )
    expect((await parseMime(direkt, VERTEILER)).weiterleitung.erkannt).toBe(false)
  })
})

describe('Absender aus Vorspann', () => {
  it.each([
    ['Von: Max Mustermann <max@example.com>', 'max@example.com'],
    ['From: anna@example.org', 'anna@example.org'],
    ['Absender: "Klein, Peter" <p.klein@example.net>', 'p.klein@example.net'],
  ])('liest %s', (zeile, erwartet) => {
    const text = ['-----Ursprüngliche Nachricht-----', zeile, 'Betreff: Test'].join('\n')
    expect(absenderAusInlineWeiterleitung(text)?.email).toBe(erwartet)
  })

  it('liefert nichts ohne Absenderzeile', () => {
    expect(absenderAusInlineWeiterleitung('Nur ein normaler Text.')).toBeNull()
  })
})

describe('Adressen aus Text', () => {
  it('liest Name und Adresse aus der spitzen Klammer', () => {
    expect(adresseAusText('Max Mustermann <max@example.com>')).toEqual({
      name: 'Max Mustermann',
      email: 'max@example.com',
    })
  })

  it('kommt auch ohne Klammern zurecht', () => {
    expect(adresseAusText('  max@example.com ')?.email).toBe('max@example.com')
  })
})

describe('Verlaufs-Kennung', () => {
  it('fasst Antwort und Weiterleitung zum selben Verlauf zusammen', () => {
    const a = bildeVerlaufsKennung('Bewerbung als Mediengestalter', 'max@example.com')
    const b = bildeVerlaufsKennung('AW: Bewerbung als Mediengestalter', 'max@example.com')
    const c = bildeVerlaufsKennung('WG: Re: Bewerbung als Mediengestalter', 'MAX@example.com')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('trennt verschiedene Absender', () => {
    expect(bildeVerlaufsKennung('Bewerbung', 'a@example.com')).not.toBe(
      bildeVerlaufsKennung('Bewerbung', 'b@example.com'),
    )
  })
})
