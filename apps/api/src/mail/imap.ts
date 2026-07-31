import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
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
 * Generisches IMAP/SMTP.
 *
 * Deckt iCloud (mit app-spezifischem Passwort), klassische Hoster-Postfächer
 * und alles ab, was kein OAuth verlangt. Für Exchange Online ist der Adapter
 * *nicht* gedacht: Dort ist Basic Auth abgeschaltet, da führt nur Graph zum
 * Ziel.
 *
 * IMAP kennt keinen Delta-Link. Der Fortschritt läuft über die UID – eine
 * Zahl, die innerhalb eines Ordners aufsteigend vergeben wird. Ihre
 * Gültigkeit hängt an der UIDVALIDITY des Ordners: Ändert der Server sie,
 * sind alle gemerkten UIDs wertlos und es wird von vorn gelesen. Doppelte
 * Nachrichten fängt danach der Dubletten-Schutz im Import ab.
 */

const SEITEN_GROESSE = 25

export class ImapAdapter implements MailAdapter {
  readonly name = 'imap'

  constructor(private konfiguration: Settings['mail']['imap']) {
    const { host, benutzer, passwort } = konfiguration
    if (!host || !benutzer || !passwort) {
      throw new MailFehler('Die IMAP-Anbindung ist unvollständig. Server, Benutzer und Passwort werden gebraucht.')
    }
  }

  private verbinde(): ImapFlow {
    return new ImapFlow({
      host: this.konfiguration.host,
      port: this.konfiguration.port,
      secure: this.konfiguration.secure,
      auth: { user: this.konfiguration.benutzer, pass: this.konfiguration.passwort },
      // Das eigene Protokoll reicht; die sehr gesprächige Ausgabe von
      // ImapFlow würde nur den Container-Log fluten.
      logger: false,
    })
  }

  /** Öffnet eine Verbindung, führt etwas aus und meldet sich sauber ab. */
  private async mitVerbindung<T>(aktion: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.verbinde()
    try {
      await client.connect()
      return await aktion(client)
    } catch (err) {
      throw new MailFehler(uebersetzeImapFehler(err), err)
    } finally {
      // logout darf den eigentlichen Fehler nicht überdecken.
      await client.logout().catch(() => undefined)
    }
  }

  async pruefeVerbindung(): Promise<VerbindungsErgebnis> {
    try {
      return await this.mitVerbindung(async (client) => {
        const sperre = await client.getMailboxLock(this.konfiguration.ordner)
        try {
          const postfach = client.mailbox
          const anzahl = typeof postfach === 'object' ? postfach.exists : 0
          return {
            ok: true,
            meldung: `Verbunden mit ${this.konfiguration.benutzer}.`,
            details: { ordner: this.konfiguration.ordner, nachrichten: anzahl },
          }
        } finally {
          sperre.release()
        }
      })
    } catch (err) {
      return { ok: false, meldung: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.' }
    }
  }

  async holeNeue(zustand: SyncZustand): Promise<AbrufErgebnis> {
    return this.mitVerbindung(async (client) => {
      const sperre = await client.getMailboxLock(this.konfiguration.ordner)
      try {
        const postfach = client.mailbox
        if (typeof postfach !== 'object') {
          throw new MailFehler(`Der Ordner „${this.konfiguration.ordner}" ließ sich nicht öffnen.`)
        }

        const uidValidity = String(postfach.uidValidity)
        // Hat der Server die UIDVALIDITY gewechselt, sind alle gemerkten UIDs
        // wertlos – dann wird der Ordner neu eingelesen.
        const gueltig = zustand.uidValidity === uidValidity
        const abVon = gueltig && zustand.lastUid ? Number(zustand.lastUid) + 1 : 1

        const mails: RohMail[] = []
        let hoechsteUid = gueltig && zustand.lastUid ? Number(zustand.lastUid) : 0

        for await (const nachricht of client.fetch(
          { uid: `${abVon}:*` },
          { uid: true, source: true, internalDate: true },
          { uid: true },
        )) {
          // Der offene Bereich `n:*` liefert immer mindestens eine Nachricht
          // zurück, auch wenn nichts Neues da ist – die muss raus.
          if (nachricht.uid < abVon) continue
          if (!nachricht.source) continue

          mails.push({
            providerMessageId: `${uidValidity}:${nachricht.uid}`,
            ordnerId: this.konfiguration.ordner,
            eingegangenAm: nachricht.internalDate ? new Date(nachricht.internalDate) : undefined,
            mime: Buffer.from(nachricht.source),
          })
          hoechsteUid = Math.max(hoechsteUid, nachricht.uid)
          if (mails.length >= SEITEN_GROESSE) break
        }

        return {
          mails,
          neuerZustand: { uidValidity, lastUid: String(hoechsteUid) },
          weitere: mails.length >= SEITEN_GROESSE,
        }
      } finally {
        sperre.release()
      }
    })
  }

  /** Aus der zusammengesetzten Kennung wieder die reine UID gewinnen. */
  private uidAus(providerMessageId: string): number {
    const teile = providerMessageId.split(':')
    const uid = Number(teile[teile.length - 1])
    if (!Number.isFinite(uid)) throw new MailFehler(`Unbrauchbare Nachrichtenkennung: ${providerMessageId}`)
    return uid
  }

  async markiereGelesen(providerMessageId: string): Promise<void> {
    const uid = this.uidAus(providerMessageId)
    await this.mitVerbindung(async (client) => {
      const sperre = await client.getMailboxLock(this.konfiguration.ordner)
      try {
        await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true })
      } finally {
        sperre.release()
      }
    })
  }

  async verschiebeInOrdner(providerMessageId: string, ordnerName: string): Promise<void> {
    const uid = this.uidAus(providerMessageId)
    await this.mitVerbindung(async (client) => {
      const vorhanden = await client.getMailboxLock(this.konfiguration.ordner)
      try {
        // Ordner anlegen, falls er fehlt. Existiert er schon, meldet der
        // Server das – kein Grund, den Import scheitern zu lassen.
        await client.mailboxCreate(ordnerName).catch(() => undefined)
        await client.messageMove({ uid: String(uid) }, ordnerName, { uid: true })
      } finally {
        vorhanden.release()
      }
    })
  }

  async sende(mail: AusgehendeMail): Promise<{ providerMessageId?: string }> {
    const k = this.konfiguration
    if (!k.smtpHost) {
      throw new MailFehler('Für den Versand fehlt der SMTP-Server in den Einstellungen.')
    }

    const versender = nodemailer.createTransport({
      host: k.smtpHost,
      port: k.smtpPort,
      secure: k.smtpSecure,
      auth: {
        // Viele Hoster nutzen dieselben Zugangsdaten für IMAP und SMTP –
        // die eigenen Felder sind nur für die Fälle da, in denen es abweicht.
        user: k.smtpBenutzer || k.benutzer,
        pass: k.smtpPasswort || k.passwort,
      },
    })

    try {
      const ergebnis = await versender.sendMail({
        from: k.absender || k.benutzer,
        to: mail.an.join(', '),
        cc: mail.kopie?.length ? mail.kopie.join(', ') : undefined,
        subject: mail.betreff,
        text: mail.text,
        html: mail.html,
        ...(mail.antwortAuf?.internetMessageId
          ? {
              inReplyTo: mail.antwortAuf.internetMessageId,
              references: [mail.antwortAuf.internetMessageId],
            }
          : {}),
        attachments: mail.anhaenge?.map((a) => ({
          filename: a.dateiname,
          content: a.inhalt,
          contentType: a.mimeTyp,
        })),
      })
      return { providerMessageId: ergebnis.messageId }
    } catch (err) {
      throw new MailFehler(uebersetzeSmtpFehler(err), err)
    } finally {
      versender.close()
    }
  }
}

function uebersetzeImapFehler(err: unknown): string {
  const meldung = err instanceof Error ? err.message : String(err)
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(meldung)) {
    return (
      'Der Server hat die Anmeldung abgelehnt. Bei iCloud und Google braucht es ein ' +
      'app-spezifisches Passwort statt des normalen Kennworts.'
    )
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(meldung)) return 'Der IMAP-Server ist nicht erreichbar. Stimmt der Servername?'
  if (/ECONNREFUSED/i.test(meldung)) return 'Der IMAP-Server verweigert die Verbindung. Stimmt der Port?'
  if (/certificate|self.signed/i.test(meldung)) return `Das Zertifikat des Servers wurde abgelehnt: ${meldung}`
  if (/NONEXISTENT|Mailbox doesn't exist/i.test(meldung)) return 'Der angegebene Ordner existiert nicht.'
  return `IMAP-Fehler: ${meldung}`
}

function uebersetzeSmtpFehler(err: unknown): string {
  const meldung = err instanceof Error ? err.message : String(err)
  if (/EAUTH|535/i.test(meldung)) return 'Der SMTP-Server hat die Anmeldung abgelehnt.'
  if (/ENOTFOUND|EAI_AGAIN/i.test(meldung)) return 'Der SMTP-Server ist nicht erreichbar.'
  if (/ECONNREFUSED/i.test(meldung)) return 'Der SMTP-Server verweigert die Verbindung. Stimmt der Port?'
  return `SMTP-Fehler: ${meldung}`
}
