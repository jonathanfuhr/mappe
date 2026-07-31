import type { Settings } from '../settings/schema'
import {
  MailFehler,
  type AbrufErgebnis,
  type AusgehendeMail,
  type MailAdapter,
  type RohMail,
  type SyncZustand,
  type VerbindungsErgebnis,
} from './types'

/**
 * Google Workspace / Gmail über die Gmail-API.
 *
 * Der Betreiber bringt seine eigene Google-Cloud-App mit (BYO-App): Client-ID,
 * Secret und ein Refresh-Token. Damit läuft der Zugriff ohne Nutzer-Login
 * weiter, sobald er einmal erteilt wurde.
 *
 * Gmail bietet einen echten Delta-Mechanismus über die `historyId`. Der erste
 * Lauf holt die jüngsten Nachrichten und merkt sich den Stand; danach werden
 * nur noch Änderungen abgefragt. Läuft die historyId ab (Google hält sie
 * begrenzt vor), wird sauber auf einen Neuabgleich zurückgefallen.
 *
 * Bewusst ohne googleapis-Paket: Für drei Endpunkte lohnt sich die
 * Abhängigkeit nicht, und fetch tut es genauso.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const TOKEN_ENDPUNKT = 'https://oauth2.googleapis.com/token'
const SEITEN_GROESSE = 25

export class GmailAdapter implements MailAdapter {
  readonly name = 'gmail'
  private token: { wert: string; laeuftAb: number } | null = null

  constructor(private konfiguration: Settings['mail']['gmail']) {
    const { clientId, clientSecret, refreshToken } = konfiguration
    if (!clientId || !clientSecret || !refreshToken) {
      throw new MailFehler(
        'Die Gmail-Anbindung ist unvollständig. Client-ID, Secret und Refresh-Token werden gebraucht.',
      )
    }
  }

  /** Holt ein Zugriffstoken und behält es, solange es gilt. */
  private async zugriffsToken(): Promise<string> {
    if (this.token && this.token.laeuftAb > Date.now() + 60_000) return this.token.wert

    const antwort = await fetch(TOKEN_ENDPUNKT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.konfiguration.clientId,
        client_secret: this.konfiguration.clientSecret,
        refresh_token: this.konfiguration.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!antwort.ok) {
      const text = await antwort.text().catch(() => '')
      if (/invalid_grant/i.test(text)) {
        throw new MailFehler(
          'Google hat das Refresh-Token abgelehnt. Es wurde vermutlich widerrufen oder ist abgelaufen – bitte neu erteilen.',
        )
      }
      throw new MailFehler(`Google hat kein Zugriffstoken ausgestellt (${antwort.status}). ${text.slice(0, 200)}`)
    }

    const daten = (await antwort.json()) as { access_token: string; expires_in: number }
    this.token = { wert: daten.access_token, laeuftAb: Date.now() + daten.expires_in * 1000 }
    return this.token.wert
  }

  private async anfrage(pfad: string, optionen: RequestInit = {}): Promise<Response> {
    const token = await this.zugriffsToken()
    const antwort = await fetch(`${API}${pfad}`, {
      ...optionen,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(optionen.body ? { 'Content-Type': 'application/json' } : {}),
        ...optionen.headers,
      },
    })
    if (!antwort.ok) {
      const text = await antwort.text().catch(() => '')
      throw new MailFehler(uebersetzeGmailFehler(antwort.status, text), text)
    }
    return antwort
  }

  async pruefeVerbindung(): Promise<VerbindungsErgebnis> {
    try {
      const antwort = await this.anfrage('/profile')
      const profil = (await antwort.json()) as { emailAddress?: string; messagesTotal?: number }
      return {
        ok: true,
        meldung: `Verbunden mit ${profil.emailAddress ?? 'dem Postfach'}.`,
        details: { postfach: profil.emailAddress ?? '', nachrichten: profil.messagesTotal ?? 0 },
      }
    } catch (err) {
      return { ok: false, meldung: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.' }
    }
  }

  async holeNeue(zustand: SyncZustand): Promise<AbrufErgebnis> {
    // Der Delta-Stand liegt im deltaLink-Feld – bei Gmail ist das die historyId.
    const historyId = zustand.deltaLink

    if (historyId) {
      try {
        return await this.holeUeberHistorie(historyId)
      } catch (err) {
        // Eine abgelaufene historyId ist kein Fehler, sondern ein Hinweis:
        // Google hält sie nur begrenzt vor. Dann von vorn.
        if (err instanceof MailFehler && /historyId|404/i.test(err.message)) {
          console.warn('[mappe] Gmail-Historie abgelaufen, es wird neu abgeglichen.')
        } else {
          throw err
        }
      }
    }

    return this.holeNeueste()
  }

  private async holeUeberHistorie(historyId: string): Promise<AbrufErgebnis> {
    const antwort = await this.anfrage(
      `/history?startHistoryId=${encodeURIComponent(historyId)}&historyTypes=messageAdded&maxResults=100`,
    )
    const daten = (await antwort.json()) as {
      history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]
      historyId?: string
    }

    const kennungen: string[] = []
    for (const eintrag of daten.history ?? []) {
      for (const hinzugefuegt of eintrag.messagesAdded ?? []) {
        // Nur der Posteingang zählt; Entwürfe und Gesendetes sind keine
        // eingehenden Bewerbungen.
        if (hinzugefuegt.message.labelIds?.includes('INBOX')) kennungen.push(hinzugefuegt.message.id)
      }
    }

    const mails = await this.ladeNachrichten(kennungen.slice(0, SEITEN_GROESSE))
    return {
      mails,
      neuerZustand: { deltaLink: daten.historyId ?? historyId },
      weitere: kennungen.length > SEITEN_GROESSE,
    }
  }

  private async holeNeueste(): Promise<AbrufErgebnis> {
    const antwort = await this.anfrage(`/messages?labelIds=INBOX&maxResults=${SEITEN_GROESSE}`)
    const daten = (await antwort.json()) as { messages?: { id: string }[] }

    const mails = await this.ladeNachrichten((daten.messages ?? []).map((m) => m.id))

    // Den aktuellen Stand merken, damit der nächste Lauf über die Historie geht.
    const profilAntwort = await this.anfrage('/profile')
    const profil = (await profilAntwort.json()) as { historyId?: string }

    return {
      mails,
      neuerZustand: { deltaLink: profil.historyId ?? null },
      weitere: false,
    }
  }

  private async ladeNachrichten(kennungen: string[]): Promise<RohMail[]> {
    const mails: RohMail[] = []
    for (const id of kennungen) {
      try {
        const antwort = await this.anfrage(`/messages/${encodeURIComponent(id)}?format=raw`)
        const daten = (await antwort.json()) as { raw?: string; internalDate?: string }
        if (!daten.raw) continue
        mails.push({
          providerMessageId: id,
          // Gmail liefert base64url – Node kennt das Format direkt.
          mime: Buffer.from(daten.raw, 'base64url'),
          eingegangenAm: daten.internalDate ? new Date(Number(daten.internalDate)) : undefined,
        })
      } catch (err) {
        console.error(`[mappe] Gmail-Nachricht ${id} konnte nicht geladen werden:`, err)
      }
    }
    return mails
  }

  async markiereGelesen(providerMessageId: string): Promise<void> {
    await this.anfrage(`/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })
  }

  async verschiebeInOrdner(providerMessageId: string, ordnerName: string): Promise<void> {
    const labelId = await this.findeOderErstelleLabel(ordnerName)
    // Bei Gmail heißt „verschieben": Label setzen und INBOX abziehen.
    await this.anfrage(`/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['INBOX'] }),
    })
  }

  private async findeOderErstelleLabel(name: string): Promise<string> {
    const antwort = await this.anfrage('/labels')
    const daten = (await antwort.json()) as { labels?: { id: string; name: string }[] }
    const vorhanden = daten.labels?.find((l) => l.name.toLowerCase() === name.toLowerCase())
    if (vorhanden) return vorhanden.id

    const angelegt = await this.anfrage('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    })
    return ((await angelegt.json()) as { id: string }).id
  }

  async sende(mail: AusgehendeMail): Promise<{ providerMessageId?: string }> {
    const mime = baueMime(mail, this.konfiguration.postfach)
    const antwort = await this.anfrage('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: mime.toString('base64url') }),
    })
    const daten = (await antwort.json()) as { id?: string }
    return { providerMessageId: daten.id }
  }
}

/**
 * Baut die MIME-Nachricht für den Versand.
 *
 * Bewusst von Hand statt über nodemailer: Der Gmail-Adapter soll ohne
 * SMTP-Transport auskommen, und mehr als ein Textkörper plus Anhänge braucht
 * es hier nicht.
 */
function baueMime(mail: AusgehendeMail, absender: string): Buffer {
  const grenze = `mappe-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  const kopfzeilen = [
    absender ? `From: ${absender}` : null,
    `To: ${mail.an.join(', ')}`,
    mail.kopie?.length ? `Cc: ${mail.kopie.join(', ')}` : null,
    `Subject: ${kodiereKopfzeile(mail.betreff)}`,
    'MIME-Version: 1.0',
    mail.antwortAuf?.internetMessageId ? `In-Reply-To: ${mail.antwortAuf.internetMessageId}` : null,
    mail.antwortAuf?.internetMessageId ? `References: ${mail.antwortAuf.internetMessageId}` : null,
  ].filter((z): z is string => Boolean(z))

  if (!mail.anhaenge?.length) {
    return Buffer.from(
      [...kopfzeilen, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', umbruch(Buffer.from(mail.text, 'utf8').toString('base64'))].join('\r\n'),
      'utf8',
    )
  }

  const teile = [
    ...kopfzeilen,
    `Content-Type: multipart/mixed; boundary="${grenze}"`,
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    umbruch(Buffer.from(mail.text, 'utf8').toString('base64')),
    '',
  ]

  for (const anhang of mail.anhaenge) {
    teile.push(
      `--${grenze}`,
      `Content-Type: ${anhang.mimeTyp}; name="${anhang.dateiname.replace(/"/g, '')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${anhang.dateiname.replace(/"/g, '')}"`,
      '',
      umbruch(anhang.inhalt.toString('base64')),
      '',
    )
  }

  teile.push(`--${grenze}--`, '')
  return Buffer.from(teile.join('\r\n'), 'utf8')
}

/** Umlaute im Betreff nach RFC 2047 kodieren. */
function kodiereKopfzeile(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/** Base64 auf 76 Zeichen umbrechen, wie es die MIME-Norm verlangt. */
function umbruch(base64: string): string {
  return base64.replace(/(.{76})/g, '$1\r\n')
}

function uebersetzeGmailFehler(status: number, koerper: string): string {
  if (status === 401) return 'Google hat den Zugriff abgelehnt. Bitte die Zugangsdaten prüfen.'
  if (status === 403) {
    return (
      'Google verweigert den Zugriff. Ist die Gmail-API in der Cloud-Konsole aktiviert und ' +
      'sind die Bereiche gmail.modify und gmail.send freigegeben?'
    )
  }
  if (status === 404) return 'Die angefragte Ressource wurde nicht gefunden (historyId womöglich abgelaufen).'
  if (status === 429) return 'Google drosselt gerade die Anfragen. Der nächste Abruf versucht es erneut.'
  return `Gmail meldet Fehler ${status}. ${koerper.slice(0, 200)}`
}
