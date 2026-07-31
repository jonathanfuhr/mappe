/**
 * Die Mail-Schnittstelle. Dahinter liegen austauschbare Adapter – Microsoft
 * Graph, generisches IMAP/SMTP, Gmail.
 *
 * Entscheidend für die Bauweise: jeder Adapter liefert die **rohe
 * MIME-Nachricht**. Geparst wird danach an einer einzigen Stelle. Damit
 * verhalten sich Weiterleitungs-Erkennung, Anhänge und Zeichensätze bei allen
 * Anbietern gleich, und das Original lässt sich unverändert als .eml ablegen.
 */

export interface RohMail {
  /** Kennung beim Anbieter – verhindert doppelten Import. */
  providerMessageId: string
  /** Ordner, aus dem die Nachricht stammt (für das spätere Verschieben). */
  ordnerId?: string
  eingegangenAm?: Date
  /** Die vollständige Nachricht als RFC-822-MIME. */
  mime: Buffer
}

export interface AbrufErgebnis {
  mails: RohMail[]
  /** Wird für den nächsten Delta-Abruf zurückgeschrieben. */
  neuerZustand: SyncZustand
  /** Es liegen noch mehr Nachrichten bereit – der Aufrufer ruft erneut ab. */
  weitere: boolean
}

export interface SyncZustand {
  deltaLink?: string | null
  uidValidity?: string | null
  lastUid?: string | null
}

export interface AusgehendeMail {
  an: string[]
  kopie?: string[]
  betreff: string
  text: string
  html?: string
  /** Setzt In-Reply-To/References, damit die Antwort im Verlauf landet. */
  antwortAuf?: { internetMessageId?: string | null } | null
  anhaenge?: { dateiname: string; inhalt: Buffer; mimeTyp: string }[]
}

export interface VerbindungsErgebnis {
  ok: boolean
  meldung: string
  /** Zusatzangaben für die Oberfläche, z. B. das erkannte Postfach. */
  details?: Record<string, string | number>
}

export interface MailAdapter {
  readonly name: string

  /** Prüft Zugangsdaten und Berechtigungen, ohne etwas zu verändern. */
  pruefeVerbindung(): Promise<VerbindungsErgebnis>

  /** Holt neue Nachrichten seit dem übergebenen Zustand. */
  holeNeue(zustand: SyncZustand): Promise<AbrufErgebnis>

  /** Abhol-Regel: nach dem Import als gelesen markieren. */
  markiereGelesen(providerMessageId: string): Promise<void>

  /**
   * Abhol-Regel: in einen Ordner verschieben. Der Ordner wird angelegt,
   * falls er noch nicht existiert.
   */
  verschiebeInOrdner(providerMessageId: string, ordnerName: string): Promise<void>

  /** Versendet als das Postfach – die Antwort landet im Gesendet-Ordner. */
  sende(mail: AusgehendeMail): Promise<{ providerMessageId?: string }>
}

/** Fehler, die der Oberfläche im Klartext gezeigt werden dürfen. */
export class MailFehler extends Error {
  constructor(
    message: string,
    public ursache?: unknown,
  ) {
    super(message)
    this.name = 'MailFehler'
  }
}
