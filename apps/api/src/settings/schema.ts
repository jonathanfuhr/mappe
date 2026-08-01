import { z } from 'zod'

/**
 * Alle Systemeinstellungen an einem Ort. Jeder Bereich hat ein Schema mit
 * Vorgabewerten – so liefert getSettings() auch bei leerer Datenbank ein
 * vollständiges Objekt, und niemand muss auf `undefined` prüfen.
 *
 * Felder, die in SECRET_PATHS stehen, werden vor dem Speichern verschlüsselt
 * und nie an die Oberfläche zurückgegeben.
 */

export const generalSchema = z.object({
  /** Erscheint im Seitentitel und in Mail-Signaturen. */
  organisation: z.string().trim().max(200).default(''),
  /** Absendername der ausgehenden Mails. */
  absenderName: z.string().trim().max(200).default(''),
  /**
   * Was im Absender steht – getrennt nach automatisch und von Hand verschickt.
   *
   * Bei einer automatisch erzeugten Mail ist ein persönlicher Name irreführend:
   * Da hat niemand geschrieben. Verschickt dagegen ein Mensch, hilft es dem
   * Bewerber zu wissen, wer sich meldet. Beide Zeilen sind frei änderbar und
   * verstehen dieselben Platzhalter wie die Mail-Vorlagen – üblich sind
   * {{ABSENDER}}, {{BEARBEITER}} und {{ORGANISATION}}.
   *
   * Die Absenderadresse bleibt in beiden Fällen das Bewerbungspostfach; nur
   * der angezeigte Name wechselt.
   */
  absenderNameAutomatisch: z.string().trim().max(200).default('{{ABSENDER}}'),
  absenderNameManuell: z.string().trim().max(200).default('{{BEARBEITER}} – {{ORGANISATION}}'),
  /** Wird an jede aus einer Vorlage erzeugte Mail angehängt. */
  signatur: z.string().max(4000).default(''),
})

export const graphSchema = z.object({
  tenantId: z.string().trim().default(''),
  clientId: z.string().trim().default(''),
  clientSecret: z.string().default(''),
  /** Das Bewerbungspostfach, z. B. bewerbung@firma.de */
  postfach: z.string().trim().default(''),
})

export const imapSchema = z.object({
  host: z.string().trim().default(''),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  benutzer: z.string().trim().default(''),
  passwort: z.string().default(''),
  ordner: z.string().trim().default('INBOX'),
  /** Ordner mit den gesendeten Nachrichten – Namen unterscheiden sich je Server. */
  gesendetOrdner: z.string().trim().default('Sent'),
  smtpHost: z.string().trim().default(''),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  smtpBenutzer: z.string().trim().default(''),
  smtpPasswort: z.string().default(''),
  absender: z.string().trim().default(''),
})

export const gmailSchema = z.object({
  clientId: z.string().trim().default(''),
  clientSecret: z.string().default(''),
  refreshToken: z.string().default(''),
  postfach: z.string().trim().default(''),
})

export const mailSchema = z.object({
  /** Welcher Adapter aktiv ist. 'aus' schaltet den Abruf komplett ab. */
  adapter: z.enum(['aus', 'graph', 'imap', 'gmail']).default('aus'),
  graph: graphSchema.default({}),
  imap: imapSchema.default({}),
  gmail: gmailSchema.default({}),
  /**
   * Auch den Gesendet-Ordner mitlesen.
   *
   * Ohne das fehlt jede Antwort im Verlauf, die jemand direkt im Postfach
   * geschrieben hat statt in Mappe – und das Team sieht nicht, dass bereits
   * geantwortet wurde. Aus dem Gesendet-Ordner entsteht nie eine neue
   * Bewerbung; die Nachrichten hängen sich nur an bestehende Verläufe.
   */
  gesendetAbrufen: z.boolean().default(true),
  /** Abhol-Regeln: was nach dem Import mit der Mail im Postfach passiert. */
  regeln: z
    .object({
      alsGelesenMarkieren: z.boolean().default(false),
      inOrdnerVerschieben: z.boolean().default(false),
      ordnerName: z.string().trim().default('Importiert'),
    })
    .default({}),
  /** Adressen, deren Mails als Weiterleitung behandelt werden (z. B. info@). */
  weiterleitungsAdressen: z.array(z.string().trim().toLowerCase()).default([]),
  /** Automatischer Abruf im Hintergrund. */
  automatischAbrufen: z.boolean().default(true),
  abrufIntervallSekunden: z.coerce.number().int().min(30).max(86400).default(120),
})

export const aiSchema = z.object({
  aktiv: z.boolean().default(false),
  /** OpenAI-kompatibler Endpunkt. Beispiele stehen in der Oberfläche. */
  basisUrl: z.string().trim().default('https://api.openai.com/v1'),
  apiKey: z.string().default(''),
  modell: z.string().trim().default('gpt-4o-mini'),
  /** Ollama braucht mehr Luft als eine API. */
  timeoutSekunden: z.coerce.number().int().min(10).max(1800).default(120),
  /** Wie viele Zeichen Bewerbungstext höchstens an die KI gehen. */
  maxZeichen: z.coerce.number().int().min(1000).max(200000).default(24000),
  aufgaben: z
    .object({
      erkennung: z.boolean().default(true),
      extraktion: z.boolean().default(true),
      zusammenfassung: z.boolean().default(true),
      pdfSplit: z.boolean().default(true),
      /**
       * Aus dem Mailverlauf eine Phase vorschlagen. Gesetzt wird nie etwas –
       * der Vorschlag landet wie jeder andere in der Prüfansicht.
       */
      status: z.boolean().default(true),
    })
    .default({}),
})

export const retentionSchema = z.object({
  /** Frist für die Bewerbung, gerechnet ab Abschluss (Zusage/Absage/Archiv). */
  bewerbungAktiv: z.boolean().default(true),
  bewerbungMonate: z.coerce.number().int().min(1).max(120).default(6),
  /** Frist für die Person – greift erst ohne aktive Bewerbung. */
  personAktiv: z.boolean().default(true),
  personMonate: z.coerce.number().int().min(1).max(120).default(6),
  /**
   * 'erinnern' sammelt Fälligkeiten nur auf und zeigt sie an,
   * 'loeschen' entfernt sie automatisch.
   */
  modus: z.enum(['erinnern', 'loeschen']).default('erinnern'),
})

export const loginSchema = z.object({
  lokalAktiv: z.boolean().default(true),
  entraAktiv: z.boolean().default(false),
  entra: z
    .object({
      tenantId: z.string().trim().default(''),
      clientId: z.string().trim().default(''),
      clientSecret: z.string().default(''),
    })
    .default({}),
  /** Nur Konten dieser Domänen dürfen sich per Microsoft anmelden. */
  erlaubteDomaenen: z.array(z.string().trim().toLowerCase()).default([]),
  /** Legt beim ersten SSO-Login automatisch ein Konto an. */
  kontenAutomatischAnlegen: z.boolean().default(false),
})

export const settingsSchemas = {
  allgemein: generalSchema,
  mail: mailSchema,
  ki: aiSchema,
  fristen: retentionSchema,
  anmeldung: loginSchema,
} as const

export type SettingsKey = keyof typeof settingsSchemas

export type Settings = {
  allgemein: z.infer<typeof generalSchema>
  mail: z.infer<typeof mailSchema>
  ki: z.infer<typeof aiSchema>
  fristen: z.infer<typeof retentionSchema>
  anmeldung: z.infer<typeof loginSchema>
}

/**
 * Pfade, die verschlüsselt gespeichert und beim Lesen für die Oberfläche
 * maskiert werden.
 */
export const SECRET_PATHS: Record<SettingsKey, string[]> = {
  allgemein: [],
  mail: ['graph.clientSecret', 'imap.passwort', 'imap.smtpPasswort', 'gmail.clientSecret', 'gmail.refreshToken'],
  ki: ['apiKey'],
  fristen: [],
  anmeldung: ['entra.clientSecret'],
}
