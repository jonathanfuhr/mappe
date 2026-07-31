import { ConfidentialClientApplication } from '@azure/msal-node'
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
 * Microsoft Graph, App-only über den Client-Credentials-Flow.
 *
 * Exchange Online hat Basic Auth abgeschaltet (IMAP länger, SMTP AUTH seit
 * 2025) – OAuth ist also nicht optional, sondern der einzige Weg. MSAL kümmert
 * sich um Beschaffung und Erneuerung des Tokens; ein Nutzer-Login ist nicht
 * nötig, die App spricht direkt mit dem Postfach.
 *
 * Benötigte Anwendungsberechtigungen im Tenant:
 *   Mail.ReadWrite  (nicht nur Mail.Read – sonst greifen die Abhol-Regeln nicht)
 *   Mail.Send
 * Idealerweise per Application Access Policy auf das Bewerbungspostfach
 * eingegrenzt, sonst darf die App jedes Postfach im Tenant lesen.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Wie viele Nachrichten ein Abruf höchstens verarbeitet. */
const SEITEN_GROESSE = 25

export class GraphAdapter implements MailAdapter {
  readonly name = 'graph'
  private msal: ConfidentialClientApplication
  private postfach: string

  constructor(private konfiguration: Settings['mail']['graph']) {
    const { tenantId, clientId, clientSecret, postfach } = konfiguration
    if (!tenantId || !clientId || !clientSecret || !postfach) {
      throw new MailFehler(
        'Die Microsoft-365-Anbindung ist unvollständig. Tenant-ID, Client-ID, Secret und Postfach werden gebraucht.',
      )
    }
    this.postfach = postfach
    this.msal = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    })
  }

  private async token(): Promise<string> {
    // MSAL hält das Token im Speicher und erneuert es selbst, sobald es
    // abläuft – hier ist kein eigenes Zwischenlager nötig.
    const ergebnis = await this.msal.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
    if (!ergebnis?.accessToken) {
      throw new MailFehler('Von Microsoft kam kein Zugriffstoken zurück. Bitte Zugangsdaten prüfen.')
    }
    return ergebnis.accessToken
  }

  private async anfrage(
    pfad: string,
    optionen: { methode?: string; koerper?: unknown; roh?: boolean; absoluteUrl?: string } = {},
  ): Promise<Response> {
    const token = await this.token()
    const url = optionen.absoluteUrl ?? `${GRAPH}${pfad}`
    const antwort = await fetch(url, {
      method: optionen.methode ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(optionen.koerper ? { 'Content-Type': 'application/json' } : {}),
        ...(optionen.roh ? { Accept: 'message/rfc822' } : {}),
      },
      body: optionen.koerper ? JSON.stringify(optionen.koerper) : undefined,
    })

    if (!antwort.ok) {
      const text = await antwort.text().catch(() => '')
      throw new MailFehler(uebersetzeGraphFehler(antwort.status, text), text)
    }
    return antwort
  }

  async pruefeVerbindung(): Promise<VerbindungsErgebnis> {
    try {
      const antwort = await this.anfrage(
        `/users/${encodeURIComponent(this.postfach)}/mailFolders/inbox?$select=displayName,totalItemCount`,
      )
      const ordner = (await antwort.json()) as { displayName?: string; totalItemCount?: number }
      return {
        ok: true,
        meldung: `Verbunden mit ${this.postfach}.`,
        details: {
          postfach: this.postfach,
          ordner: ordner.displayName ?? 'Posteingang',
          nachrichten: ordner.totalItemCount ?? 0,
        },
      }
    } catch (err) {
      return { ok: false, meldung: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.' }
    }
  }

  async holeNeue(zustand: SyncZustand): Promise<AbrufErgebnis> {
    // Der erste Lauf legt einen Delta-Link an; danach liefert Graph nur noch,
    // was sich seither geändert hat.
    const start =
      zustand.deltaLink ??
      `${GRAPH}/users/${encodeURIComponent(this.postfach)}/mailFolders/inbox/messages/delta` +
        `?$select=id,internetMessageId,conversationId,subject,receivedDateTime,isRead&$top=${SEITEN_GROESSE}`

    const antwort = await this.anfrage('', { absoluteUrl: start })
    const seite = (await antwort.json()) as {
      value?: { id: string; receivedDateTime?: string; '@removed'?: unknown }[]
      '@odata.nextLink'?: string
      '@odata.deltaLink'?: string
    }

    const mails: RohMail[] = []
    for (const eintrag of seite.value ?? []) {
      // Gelöschte Nachrichten kommen als Tombstone – die überspringen wir.
      if (eintrag['@removed'] || !eintrag.id) continue
      try {
        mails.push({
          providerMessageId: eintrag.id,
          eingegangenAm: eintrag.receivedDateTime ? new Date(eintrag.receivedDateTime) : undefined,
          mime: await this.holeMime(eintrag.id),
        })
      } catch (err) {
        // Eine einzelne unlesbare Nachricht darf den ganzen Lauf nicht stoppen.
        console.error(`[mappe] Nachricht ${eintrag.id} konnte nicht geladen werden:`, err)
      }
    }

    return {
      mails,
      neuerZustand: {
        // Solange nextLink kommt, ist die Seite noch nicht zu Ende; erst der
        // deltaLink markiert den Stand für den nächsten Lauf.
        deltaLink: seite['@odata.deltaLink'] ?? seite['@odata.nextLink'] ?? zustand.deltaLink ?? null,
      },
      weitere: Boolean(seite['@odata.nextLink']),
    }
  }

  /** Holt die unveränderte MIME-Nachricht – Grundlage für Parser und .eml-Ablage. */
  private async holeMime(id: string): Promise<Buffer> {
    const antwort = await this.anfrage(
      `/users/${encodeURIComponent(this.postfach)}/messages/${encodeURIComponent(id)}/$value`,
      { roh: true },
    )
    return Buffer.from(await antwort.arrayBuffer())
  }

  async markiereGelesen(providerMessageId: string): Promise<void> {
    await this.anfrage(
      `/users/${encodeURIComponent(this.postfach)}/messages/${encodeURIComponent(providerMessageId)}`,
      { methode: 'PATCH', koerper: { isRead: true } },
    )
  }

  async verschiebeInOrdner(providerMessageId: string, ordnerName: string): Promise<void> {
    const ordnerId = await this.findeOderErstelleOrdner(ordnerName)
    await this.anfrage(
      `/users/${encodeURIComponent(this.postfach)}/messages/${encodeURIComponent(providerMessageId)}/move`,
      { methode: 'POST', koerper: { destinationId: ordnerId } },
    )
  }

  private async findeOderErstelleOrdner(name: string): Promise<string> {
    const suche = await this.anfrage(
      `/users/${encodeURIComponent(this.postfach)}/mailFolders?$filter=displayName eq '${name.replace(/'/g, "''")}'&$select=id`,
    )
    const treffer = (await suche.json()) as { value?: { id: string }[] }
    if (treffer.value?.[0]?.id) return treffer.value[0].id

    const angelegt = await this.anfrage(`/users/${encodeURIComponent(this.postfach)}/mailFolders`, {
      methode: 'POST',
      koerper: { displayName: name },
    })
    return ((await angelegt.json()) as { id: string }).id
  }

  async sende(mail: AusgehendeMail): Promise<{ providerMessageId?: string }> {
    const nachricht: Record<string, unknown> = {
      subject: mail.betreff,
      body: mail.html
        ? { contentType: 'HTML', content: mail.html }
        : { contentType: 'Text', content: mail.text },
      toRecipients: mail.an.map((adresse) => ({ emailAddress: { address: adresse } })),
      ...(mail.kopie?.length
        ? { ccRecipients: mail.kopie.map((adresse) => ({ emailAddress: { address: adresse } })) }
        : {}),
      ...(mail.anhaenge?.length
        ? {
            attachments: mail.anhaenge.map((anhang) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: anhang.dateiname,
              contentType: anhang.mimeTyp,
              contentBytes: anhang.inhalt.toString('base64'),
            })),
          }
        : {}),
    }

    // Antworten sollen im Verlauf des Bewerbers landen, nicht als neuer Faden.
    if (mail.antwortAuf?.internetMessageId) {
      nachricht.internetMessageHeaders = [
        { name: 'In-Reply-To', value: mail.antwortAuf.internetMessageId },
        { name: 'References', value: mail.antwortAuf.internetMessageId },
      ]
    }

    await this.anfrage(`/users/${encodeURIComponent(this.postfach)}/sendMail`, {
      methode: 'POST',
      koerper: { message: nachricht, saveToSentItems: true },
    })
    // sendMail liefert keine Kennung zurück – die Nachricht liegt im
    // Gesendet-Ordner, mehr braucht es für unseren Verlauf nicht.
    return {}
  }
}

function uebersetzeGraphFehler(status: number, koerper: string): string {
  if (status === 401) {
    return 'Microsoft hat die Anmeldung abgelehnt. Tenant-ID, Client-ID und Secret prüfen (ist das Secret abgelaufen?).'
  }
  if (status === 403) {
    return (
      'Microsoft verweigert den Zugriff. Fehlen die Anwendungsberechtigungen Mail.ReadWrite und Mail.Send, ' +
      'oder schließt die Application Access Policy dieses Postfach aus?'
    )
  }
  if (status === 404) {
    return `Das Postfach oder der Ordner wurde nicht gefunden. Stimmt die Adresse des Bewerbungspostfachs?`
  }
  if (status === 429) {
    return 'Microsoft drosselt gerade die Anfragen. Der nächste Abruf versucht es erneut.'
  }
  const kurz = koerper.slice(0, 300)
  return `Microsoft Graph meldet Fehler ${status}.${kurz ? ' ' + kurz : ''}`
}
